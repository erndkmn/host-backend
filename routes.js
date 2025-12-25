// Simple in-memory cache for /items/today
const itemsTodayCache = {};
// Simple in-memory cache for /weaponsNew/today
const weaponsNewTodayCache = {};

import express from "express";
import fetch from "node-fetch";
import seedrandom from "seedrandom";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

// Simple in-memory cache for /arcsNew/today
const arcsNewTodayCache = {};
// TTL will be calculated dynamically to expire at next local midnight

const router = express.Router();
const BASE = "https://metaforge.app/api/arc-raiders";
const STATE_FILE = path.resolve("./gameState.json");

// Helper to load game state
async function getGameState() {
  try {
    const data = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return {
      history: {}, // Maps "YYYY-MM-DD" -> { id, image }
      availableIds: [],
      shownIds: [],
    };
  }
}

// Helper to save game state
async function saveGameState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// Proxy route to fetch external images and bypass CORS (MUST BE BEFORE /:name route)
router.get("/proxy-image", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    console.log("Proxying image:", url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    // FIX: Bessere Content-Type Erkennung
    let contentType = response.headers.get("content-type");

    // Wenn kein Content-Type da ist, raten wir anhand der Endung oder nehmen Standard
    if (!contentType) {
      if (url.endsWith(".webp")) contentType = "image/webp";
      else if (url.endsWith(".jpg") || url.endsWith(".jpeg"))
        contentType = "image/jpeg";
      else if (url.endsWith(".png")) contentType = "image/png";
      else contentType = "image/png"; // Fallback
    }

    res.set("Content-Type", contentType);
    res.set("Access-Control-Allow-Origin", "*");
    // WICHTIG: Caching deaktivieren, damit Browser nicht alte kaputte Versionen behalten
    res.set("Cache-Control", "no-cache");

    res.send(Buffer.from(buffer));

    console.log("Image proxied successfully");
  } catch (err) {
    console.error("Error proxying image:", err);
    // Sende ein leeres 404 statt JSON Fehler, damit das Frontend den Fallback auslösen kann
    res.status(404).send("Image not found");
  }
});

// IMPORTANT: /today routes MUST come BEFORE generic routes!

// Get today's arc (BEFORE /arcs)
// router.get("/arcs/today", async (req, res) => {
//   try {
//     // Get timezone offset from query parameter (in minutes)
//     const timezoneOffset = parseInt(req.query.offset) || 0;

//     // Calculate user's local date
//     const now = new Date();
//     const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);

//     const year = userLocalTime.getUTCFullYear();
//     const month = userLocalTime.getUTCMonth() + 1;
//     const day = userLocalTime.getUTCDate();

//     const dateKey = `${year}-${month}-${day}`;
//     console.log(`Requesting Arc for date: ${dateKey}`);

//     // 1. Load State
//     let state = await getGameState();
//     let todaysSelection = state.history[dateKey];

//     // FIX: Check if the saved selection is invalid (empty image). If so, force re-selection.
//     if (
//       todaysSelection &&
//       (!todaysSelection.image || todaysSelection.image.trim() === "")
//     ) {
//       console.log(
//         `Invalid selection found for ${dateKey} (no image). Re-rolling...`
//       );
//       todaysSelection = null;
//     }

//     // 2. If no selection for this date, run rotation logic
//     if (!todaysSelection) {
//       console.log("No valid Arc selected for today. Running rotation logic...");

//       // Fetch all arcs to populate pools or find image URL
//       let page = 1;
//       let allArcs = [];
//       let hasNext = true;

//       while (hasNext) {
//         const url = `${BASE}/arcs?page=${page}&limit=100`;
//         const response = await fetch(url);
//         const data = await response.json();

//         // FILTER: Only keep arcs that actually have an image URL
//         const validArcs = data.data.filter(
//           (a) => a.image && a.image.trim() !== ""
//         );
//         allArcs.push(...validArcs);

//         hasNext = data.pagination?.hasNextPage;
//         page++;
//         if (page > 100) break;
//       }

//       // Initialize availableIds if brand new
//       if (state.availableIds.length === 0 && state.shownIds.length === 0) {
//         console.log("Initializing ID pool...");
//         state.availableIds = allArcs.map((a) => a.id);
//       }

//       // Reset pool if empty
//       if (state.availableIds.length === 0) {
//         console.log("Available pool empty. Resetting from shown pool.");
//         state.availableIds = [...state.shownIds];
//         state.shownIds = [];
//       }

//       // Pick random ID and ensure it exists in the valid list
//       let selectedId;
//       let selectedArc;

//       // Safety loop to find a valid ID
//       while (!selectedArc && state.availableIds.length > 0) {
//         const randomIndex = Math.floor(
//           Math.random() * state.availableIds.length
//         );
//         const candidateId = state.availableIds[randomIndex];

//         // Check if this ID actually has an image (exists in our filtered allArcs)
//         selectedArc = allArcs.find((a) => a.id === candidateId);

//         if (selectedArc) {
//           selectedId = candidateId;
//           // Move ID: available -> shown
//           state.availableIds.splice(randomIndex, 1);
//           state.shownIds.push(selectedId);
//         } else {
//           // ID is in pool but has no image in API (like bombardier). Remove it and try again.
//           console.log(`Skipping ID without image: ${candidateId}`);
//           state.availableIds.splice(randomIndex, 1);
//         }
//       }

//       if (!selectedArc) {
//         // Fallback if everything fails (should not happen)
//         throw new Error("No valid arcs with images found available.");
//       }

//       // Save to history
//       todaysSelection = { id: selectedId, image: selectedArc.image };
//       state.history[dateKey] = todaysSelection;

//       await saveGameState(state);
//       console.log(`New Arc selected: ${selectedId}`);
//     } else {
//       console.log(`Returning cached Arc: ${todaysSelection.id}`);
//     }

//     // 3. Serve the image
//     res.json({
//       id: todaysSelection.id,
//       image: todaysSelection.image,
//     });
//   } catch (err) {
//     console.error("Error in /arcs/today:", err);
//     res
//       .status(500)
//       .json({ error: "Failed to pull today's arc", details: err.message });
//   }
// });

// Get today's item (BEFORE /items)
router.get("/items/today", async (req, res) => {
  try {
    // Get timezone offset from query parameter (in minutes)
    const timezoneOffset = parseInt(req.query.offset) || 0;

    // Calculate user's local date
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);

    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();

    const cacheKey = `items-today-${year}-${month}-${day}-offset-${timezoneOffset}`;
    const cached = itemsTodayCache[cacheKey];
    if (cached && Date.now() < cached.expiry) {
      return res.json(cached.data);
    }

    const seed = `${year}${month}${day}`;
    const rng = seedrandom(seed);

    console.log(`User's local date: ${year}-${month}-${day}`);
    console.log(`Seed: ${seed}`);

    // Fetch ALL items with pagination
    let page = 1;
    let allItems = [];
    let hasNext = true;

    while (hasNext) {
      const url = `${BASE}/items?page=${page}&limit=100`;
      const response = await fetch(url);
      const data = await response.json();

      allItems.push(...data.data);

      hasNext = data.pagination?.hasNextPage;
      page++;

      if (page > 100) break;
    }

    const index = Math.floor(rng() * allItems.length);
    const todaysItem = allItems[index];

    // Prepare response in the same format as /weaponsNew/today and /arcsNew/today
    const response = {
      allItems: allItems,
      today: todaysItem,
    };

    // Calculate expiry: next local midnight for the user's timezone
    const nextMidnight = new Date(userLocalTime);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    const expiry = nextMidnight.getTime();

    // Store in cache
    itemsTodayCache[cacheKey] = {
      data: response,
      expiry: expiry,
    };

    console.log(`Today's item: ${response.today.name}`);

    res.json(response);
  } catch (err) {
    console.error("Error in /items/today:", err);
    res
      .status(500)
      .json({ error: "Failed to pull today's item", details: err.message });
  }
});

// Get today's weapon (BEFORE /weapons)
router.get("/weapons/today", async (req, res) => {
  try {
    // Get timezone offset from query parameter (in minutes)
    const timezoneOffset = parseInt(req.query.offset) || 0;

    // Calculate user's local date
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);

    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();

    const seed = `${year}${month}${day}`;
    const rng = seedrandom(seed);

    console.log(`User's local date: ${year}-${month}-${day}`);
    console.log(`Seed: ${seed}`);

    // Fetch ALL weapons with pagination
    let page = 1;
    let allWeapons = [];
    let hasNext = true;

    while (hasNext) {
      const url = `${BASE}/items?page=${page}&limit=100&item_type=Weapon`;
      console.log(`Fetching weapons: ${url}`);
      const response = await fetch(url);
      const data = await response.json();

      allWeapons.push(...data.data);

      hasNext = data.pagination?.hasNextPage;
      page++;

      if (page > 100) break;
    }

    console.log(`Total weapons fetched: ${allWeapons.length}`);

    // Pick today's weapon
    const index = Math.floor(rng() * allWeapons.length);
    const todaysWeapon = allWeapons[index];

    console.log(`Today's weapon index: ${index}`);
    console.log(`Today's weapon:`, todaysWeapon);

    res.json(todaysWeapon);
  } catch (err) {
    console.error("Error in /weapons/today:", err);
    res
      .status(500)
      .json({ error: "Failed to pull today's weapon", details: err.message });
  }
});

// Get all arcs (AFTER /arcs/today)
let allArcsCache = null;
const arcCacheNew = {};
// Test route: get today's arc using offset and allArcsCache
router.get("/arcs/getTest", async (req, res) => {
  try {
    // Get timezone offset from query parameter (in minutes)
    const timezoneOffset = parseInt(req.query.offset) || 0;
    // Calculate user's local date
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);
    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();
    const dateKey = `${year}-${month}-${day}`;

    // Check if allArcsCache is populated
    if (!allArcsCache || !Array.isArray(allArcsCache) || allArcsCache.length === 0) {
      return res.status(503).json({ error: "allArcsCache not populated yet" });
    }

    // Check cache for today's arc
    const cacheKey = `arc-getTest-${dateKey}`;
    const cached = arcCacheNew[cacheKey];
    if (cached && Date.now() < cached.expiry) {
      return res.json(cached.data);
    }

    // Seed RNG with date
    const seed = `${year}${month}${day}`;
    const rng = seedrandom(seed);
    // Pick random arc
    const index = Math.floor(rng() * allArcsCache.length);
    const todaysArc = allArcsCache[index];

    // Prepare response
    const responseObj = {
      allArcs: allArcsCache,
      today: {
        name: todaysArc?.name || "",
        imgUrl: todaysArc?.image || ""
      }
    };

    // Calculate expiry: next local midnight for the user's timezone
    const nextMidnight = new Date(userLocalTime);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    const expiry = nextMidnight.getTime();

    // Store in cache
    arcCacheNew[cacheKey] = {
      data: responseObj,
      expiry: expiry,
    };

    res.json(responseObj);
  } catch (err) {
    console.error("Error in /arcs/getTest:", err);
    res.status(500).json({ error: "Failed to get test arc", details: err.message });
  }
});
router.get("/arcs", async (req, res) => {
  try {
    let page = 1;
    let results = [];
    let hasNext = true;

    while (hasNext) {
      const url = `${BASE}/arcs?page=${page}&limit=100`;
      const response = await fetch(url);
      const data = await response.json();

      results.push(...data.data);

      hasNext = data.pagination.hasNextPage;
      page++;
    }

    res.json(results);
    allArcsCache = results;
  } catch (err) {
    res.status(500).json({ error: "Failed to pull items", details: err });
  }
});




// Get all items (AFTER /items/today)
router.get("/items", async (req, res) => {
  try {
    let page = 1;
    let results = [];
    let hasNext = true;

    while (hasNext) {
      const url = `${BASE}/items?page=${page}&limit=100`;
      const response = await fetch(url);
      const data = await response.json();

      results.push(...data.data);

      hasNext = data.pagination.hasNextPage;
      page++;
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Failed to pull items", details: err });
  }
});

// Get all arcs with today's arc (AFTER /arcs/today, BEFORE /arcs)
router.get("/arcsNew/today", async (req, res) => {
  try {
    // Get timezone offset from query parameter (in minutes)
    const timezoneOffset = parseInt(req.query.offset) || 0;

    // Calculate user's local date
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);

    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();
    const dateKey = `${year}-${month}-${day}`;

    const cacheKey = `arcsNew-today-${dateKey}-offset-${timezoneOffset}`;

    // Check cache
    const cached = arcsNewTodayCache[cacheKey];
    if (cached && Date.now() < cached.expiry) {
      // Serve from cache
      return res.json(cached.data);
    }
    console.log("1");

    // Calculate expiry: next local midnight for the user's timezone
    const nextMidnight = new Date(userLocalTime);
    nextMidnight.setUTCHours(0, 0, 0, 0); // Set to local midnight
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1); // Move to next day
    const expiry = nextMidnight.getTime();

    console.log(`Requesting Arc for date: ${dateKey} (offset: ${timezoneOffset})`);

    // 1. Load State
    let state = await getGameState();
    let todaysSelection = state.history[dateKey];

    // Fetch ALL arcs with pagination (and filter for valid images)
    let page = 1;
    let allArcs = [];
    let hasNext = true;
    while (hasNext) {
      const url = `${BASE}/arcs?page=${page}&limit=100`;
      const response = await fetch(url);
      const data = await response.json();
      // Only keep arcs with a valid image
      const validArcs = data.data.filter(a => a.image && a.image.trim() !== "");
      allArcs.push(...validArcs);
      hasNext = data.pagination?.hasNextPage;
      page++;
      if (page > 100) break;
    }
    console.log(`Total arcs fetched for arcsNew: ${allArcs.length}`);

    // FIX: Check if the saved selection is invalid (empty image). If so, force re-selection.
    if (
      todaysSelection &&
      (!todaysSelection.image || todaysSelection.image.trim() === "")
    ) {
      console.log(
        `Invalid selection found for ${dateKey} (no image). Re-rolling...`
      );
      todaysSelection = null;
    }

    // 2. If no selection for this date, run rotation logic
    if (!todaysSelection) {
      console.log("No valid Arc selected for today. Running rotation logic...");

      // Initialize availableIds if brand new
      if (state.availableIds.length === 0 && state.shownIds.length === 0) {
        console.log("Initializing ID pool...");
        state.availableIds = allArcs.map((a) => a.id);
      }

      // Reset pool if empty
      if (state.availableIds.length === 0) {
        console.log("Available pool empty. Resetting from shown pool.");
        state.availableIds = [...state.shownIds];
        state.shownIds = [];
      }

      // Pick random ID and ensure it exists in the valid list
      let selectedId;
      let selectedArc;

      // Safety loop to find a valid ID
      while (!selectedArc && state.availableIds.length > 0) {
        const randomIndex = Math.floor(
          Math.random() * state.availableIds.length
        );
        const candidateId = state.availableIds[randomIndex];

        // Check if this ID actually has an image (exists in our filtered allArcs)
        selectedArc = allArcs.find((a) => a.id === candidateId);

        if (selectedArc) {
          selectedId = candidateId;
          // Move ID: available -> shown
          state.availableIds.splice(randomIndex, 1);
          state.shownIds.push(selectedId);
        } else {
          // ID is in pool but has no image in API (like bombardier). Remove it and try again.
          console.log(`Skipping ID without image: ${candidateId}`);
          state.availableIds.splice(randomIndex, 1);
        }
      }

      if (!selectedArc) {
        // Fallback if everything fails (should not happen)
        throw new Error("No valid arcs with images found available.");
      }

      // Save to history
      todaysSelection = { id: selectedId, image: selectedArc.image };
      state.history[dateKey] = todaysSelection;

      await saveGameState(state);
      console.log(`New Arc selected: ${selectedId}`);
    } else {
      console.log(`Returning cached Arc: ${todaysSelection.id}`);
    }

    // Find today's arc in allArcs for full info
    const todaysArc = allArcs.find(a => a.id === todaysSelection.id);

    // Create response in requested format
    const responseObj = {
      allArcs: allArcs,
      today: {
        name: todaysArc?.name || "",
        imgUrl: todaysArc?.image || "",
      },
    };


    // Store in cache with expiry at next local midnight
    arcsNewTodayCache[cacheKey] = {
      data: responseObj,
      expiry: expiry,
    };

    res.json(responseObj);
  } catch (err) {
    console.error("Error in /arcsNew/today:", err);
    res.status(500).json({
      error: "Failed to fetch arcs",
      details: err.message,
    });
  }
});

// Get all weapons with today's weapon (BEFORE /weapons)
router.get("/weaponsNew/today", async (req, res) => {
  try {
    // Get timezone offset from query parameter (in minutes)
    const timezoneOffset = parseInt(req.query.offset) || 0;
    
    // Calculate user's local date
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);
    
    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();
    
    const cacheKey = `weaponsNew-today-${year}-${month}-${day}-offset-${timezoneOffset}`;
    
    // Check cache
    const cached = weaponsNewTodayCache[cacheKey];
    if (cached && Date.now() < cached.expiry) {
      console.log("---------------------------------------------------------------------------------------------------------------------------------------------------------");
      console.log(weaponsNewTodayCache);
      return res.json(cached.data);
    }

    const seed = `weapons${year}${month}${day}`;
    const rng = seedrandom(seed);

    console.log(`User's local date: ${year}-${month}-${day}`);
    console.log(`Seed for weaponsNew: ${seed}`);

    // Fetch ALL weapons with pagination
    let page = 1;
    let allWeapons = [];
    let hasNext = true;

    while (hasNext) {
      const url = `${BASE}/items?page=${page}&limit=100&item_type=Weapon`;
      console.log(`Fetching weapons: ${url}`);
      const response = await fetch(url);
      const data = await response.json();

      allWeapons.push(...data.data);

      hasNext = data.pagination?.hasNextPage;
      page++;

      if (page > 100) break;
    }

    console.log(`Total weapons fetched (before filtering): ${allWeapons.length}`);

    // Filter: Keep weapons that either:
    // 1. End with " I" (level 1) - remove the " I"
    // 2. End with "Rifle" (special case without level number)
    const levelOneWeapons = allWeapons
      .filter(weapon => weapon.id.endsWith("-i") || weapon.id.endsWith("-rifle"))
      .map(weapon => ({
        ...weapon,
        name: weapon.name.replace(/ I$/, "") // Remove " I" from end (if present)
      }));

    console.log(`Level 1 weapons after filtering: ${levelOneWeapons.length}`);

    // Pick today's weapon from level 1 weapons only
    const index = Math.floor(rng() * levelOneWeapons.length);
    const todaysWeapon = levelOneWeapons[index];
    const todaysWeaponDescription = todaysWeapon.description;

    console.log(`Today's weapon index: ${index}`);
    console.log(`Today's weapon:`, todaysWeapon);

    // Create response in requested format
    const response = {
      allWeapons: levelOneWeapons,
      today: {
        name: todaysWeapon.name,
        imgUrl: todaysWeapon.icon,
        description: todaysWeaponDescription,
      },
    };

    // Calculate expiry: next local midnight for the user's timezone
    const nextMidnight = new Date(userLocalTime);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    const expiry = nextMidnight.getTime();

    // Store in cache
    weaponsNewTodayCache[cacheKey] = {
      data: response,
      expiry: expiry,
    };

    res.json(response);
  } catch (err) {
    console.error("Error in /weaponsNew:", err);
    res.status(500).json({
      error: "Failed to fetch weapons",
      details: err.message,
    });
  }
});

// Get all icons
router.get("/icons", async (req, res) => {
  try {
    const imagesDir = path.resolve("./icons");
    const files = await fs.readdir(imagesDir);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    
    // Transform filenames to readable names
    const icons = imageFiles.map(filename => {
      // Remove extension
      let name = filename.replace(/\.[^/.]+$/, "");
      // Remove _icon or _icons suffix
      name = name.replace(/_(icon|icons?)$/i, "");
      // Replace underscores with spaces and capitalize
      name = name.split("_").map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(" ");
      
      return {
        filename,
        name,
        imageUrl: `/api/icons/image/${filename}`
      };
    });
    
    res.json(icons);
  } catch (err) {
    console.error("Error fetching icons:", err);
    res.status(500).json({ error: "Failed to fetch icons" });
  }
});

// Get today's icon (returns JSON with filename)
router.get("/icons/today", async (req, res) => {
  try {
    const timezoneOffset = parseInt(req.query.offset) || 0;
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);
    
    const year = userLocalTime.getFullYear();
    const month = userLocalTime.getMonth() + 1;
    const day = userLocalTime.getDate();
    const seed = `icons${year}${month}${day}`;
    const rng = seedrandom(seed);

    console.log(`User's local date: ${year}-${month}-${day}`);
    console.log(`Seed for icons: ${seed}`);

    // Read images from folder
    const imagesDir = path.resolve("./icons");
    const files = await fs.readdir(imagesDir);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    
    if (imageFiles.length === 0) {
      return res.status(404).json({ error: "No icons found" });
    }

    // Pick random image for today
    const index = Math.floor(rng() * imageFiles.length);
    const selectedImage = imageFiles[index];
    
    console.log(`Today's icon: ${selectedImage}`);
    
    // Transform filename to readable name
    let name = selectedImage.replace(/\.[^/.]+$/, ""); // Remove extension
    name = name.replace(/_(icon|icons?)$/i, ""); // Remove _icon or _icons suffix
    name = name.split("_").map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(" "); // Replace underscores with spaces and capitalize
    
    // Return JSON with image info
    res.json({
      filename: selectedImage,
      name: name,
      imageUrl: `https://api.raiderdle.com/api/icons/image/${selectedImage}`
    });
  } catch (err) {
    console.error("Error in /icons/today:", err);
    res.status(500).json({ error: "Failed to get daily icon" });
  }
});

// Serve icon images (static file route)
router.get("/icons/image/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const imagesDir = path.resolve("./icons");
    const filePath = path.join(imagesDir, filename);
    
    // Security check: ensure the file is within the icons directory
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(imagesDir)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: "Icon not found" });
    }
    
    // Set appropriate headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-cache, no-store, must-revalidate"); // No caching during development
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    
    res.sendFile(resolvedPath);
  } catch (err) {
    console.error("Error serving icon:", err);
    res.status(500).json({ error: "Failed to serve icon" });
  }
});


// app.post('/api/bug-report', async (req, res) => {
//   const { message, modes } = req.body;

//   if (!message || !modes?.length) {
//     return res.status(400).json({ error: 'Invalid payload' });
//   }

//   try {
//     await pool.query(
//       `INSERT INTO bug_reports (message, modes)
//        VALUES ($1, $2)`,
//       [message, modes]
//     );

//     res.json({ ok: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'DB error' });
//   }
// });


export default router;
