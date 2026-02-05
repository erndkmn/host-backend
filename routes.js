// Simple in-memory cache for /items/today
const itemsTodayCache = {};
// Simple in-memory cache for /weaponsNew/today
const weaponsNewTodayCache = {};
// Simple in-memory cache for /items/valued (with TTL)
const valuedItemsCache = {
  data: null,
  expiry: 0
};
const VALUED_ITEMS_TTL = 60 * 60 * 1000; // 1 hour TTL

import { pool } from "./db.js";
import express from "express";
import fetch from "node-fetch";
import seedrandom from "seedrandom";
import sharp from "sharp";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

// Load wordle words
// WORDLE_ANSWERS = possible correct answers (from words.json)
const wordsData = JSON.parse(fsSync.readFileSync('./words.json', 'utf8'));
const WORDLE_ANSWERS = wordsData.words.filter(w => w.length === 5).map(w => w.toUpperCase());

// VALID_WORDLE_INPUTS = all accepted input guesses (from validInputWordle.txt)
const validInputData = fsSync.readFileSync('./validInputWordle.txt', 'utf8');
const VALID_WORDLE_INPUTS = new Set(
  validInputData.split('\n').map(w => w.trim().toUpperCase()).filter(w => w.length === 5)
);
// Also include all answers as valid inputs
WORDLE_ANSWERS.forEach(w => VALID_WORDLE_INPUTS.add(w));

// Simple in-memory cache for wordle
const wordleTodayCache = {};

// Simple in-memory cache for /arcsNew/today
const arcsNewTodayCache = {};
// TTL will be calculated dynamically to expire at next local midnight

const router = express.Router();
const BASE = "https://metaforge.app/api/arc-raiders";
const STATE_FILE = path.resolve("./gameState.json");


const SCREENSHOTS_DIR = './screenshots';

// HUD margins (percentage of image to exclude)
const HUD_MARGINS = {
  top: 0.10,      // 10% from top
  bottom: 0.15,   // 15% from bottom
  left: 0.05,     // 5% from left
  right: 0.05     // 5% from right
};

// Snippet size based on difficulty
const SNIPPET_SIZES = {
  hard: { width: 200, height: 200 },    // Small crop = harder
  medium: { width: 300, height: 300 },  // Medium crop
  easy: { width: 400, height: 400 }     // Larger crop = easier
};

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

// Get a random item that has a "value" key (cached with TTL)
router.get("/items/valued", async (req, res) => {
  try {
    // Check if cache is valid
    let allItems;
    if (valuedItemsCache.data && Date.now() < valuedItemsCache.expiry) {
      console.log("Using cached items for /items/valued");
      allItems = valuedItemsCache.data;
    } else {
      console.log("Fetching items from API for /items/valued");
      
      // Fetch ALL items with pagination
      let page = 1;
      allItems = [];
      let hasNext = true;

      while (hasNext) {
        const url = `https://metaforge.app/api/arc-raiders/items?page=${page}&limit=100`;
        const response = await fetch(url);
        const data = await response.json();

        allItems.push(...data.data);

        hasNext = data.pagination?.hasNextPage;
        page++;

        if (page > 100) break; // Safety limit
      }

      // Update cache with TTL
      valuedItemsCache.data = allItems;
      valuedItemsCache.expiry = Date.now() + VALUED_ITEMS_TTL;
      
      console.log(`Cached ${allItems.length} items for /items/valued`);
    }

    // Filter items that have a "value" key with a truthy value
    const valuedItems = allItems.filter(item => item.value !== undefined && item.value !== null && item.value !== "");

    if (valuedItems.length === 0) {
      return res.status(404).json({ error: "No items with 'value' key found" });
    }

    // Pick a random item
    const index = Math.floor(Math.random() * valuedItems.length);
    const randomValuedItem = valuedItems[index];

    console.log(`Returning valued item: ${randomValuedItem.name} (value: ${randomValuedItem.value})`);

    res.json(randomValuedItem);
  } catch (err) {
    console.error("Error in /items/valued:", err);
    res
      .status(500)
      .json({ error: "Failed to get valued item", details: err.message });
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

// ============ WORDLE ROUTES ============

// Get today's wordle word
router.get("/wordle/today", async (req, res) => {
  try {
    const timezoneOffset = parseInt(req.query.offset) || 0;
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);
    
    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();
    const dateKey = `${year}-${month}-${day}`;
    
    // Check cache
    if (wordleTodayCache[dateKey]) {
      console.log(`Returning cached wordle word for ${dateKey}`);
      return res.json(wordleTodayCache[dateKey]);
    }
    
    // Generate deterministic word for today
    const seed = `wordle${year}${month}${day}`;
    const rng = seedrandom(seed);
    
    if (WORDLE_ANSWERS.length === 0) {
      return res.status(500).json({ error: "No valid 5-letter words found" });
    }
    
    const index = Math.floor(rng() * WORDLE_ANSWERS.length);
    const todayWord = WORDLE_ANSWERS[index];
    
    console.log(`Today's wordle word (${dateKey}): ${todayWord}`);
    
    // Cache the result
    const result = {
      wordLength: todayWord.length,
      // Don't send the actual word - the frontend will validate guesses via the check route
    };
    wordleTodayCache[dateKey] = result;
    
    res.json(result);
  } catch (err) {
    console.error("Error in /wordle/today:", err);
    res.status(500).json({ error: "Failed to get daily wordle" });
  }
});

// Check a wordle guess
router.post("/wordle/check", async (req, res) => {
  try {
    const { guess } = req.body;
    const timezoneOffset = parseInt(req.query.offset) || 0;
    
    if (!guess || typeof guess !== 'string') {
      return res.status(400).json({ error: "Invalid guess" });
    }
    
    const normalizedGuess = guess.toUpperCase().trim();
    
    if (normalizedGuess.length !== 5) {
      return res.status(400).json({ error: "Guess must be 5 letters" });
    }
    
    // Check if the guess is a valid word
    if (!VALID_WORDLE_INPUTS.has(normalizedGuess)) {
      return res.status(400).json({ error: "Not a valid word", isInvalidWord: true });
    }
    
    // Get today's word
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);
    
    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();
    
    const seed = `wordle${year}${month}${day}`;
    const rng = seedrandom(seed);
    const index = Math.floor(rng() * WORDLE_ANSWERS.length);
    const todayWord = WORDLE_ANSWERS[index];
    
    // Calculate result for each letter
    // 'correct' = right letter, right position (green)
    // 'present' = right letter, wrong position (yellow)
    // 'absent' = letter not in word (gray)
    const result = [];
    const wordLetters = todayWord.split('');
    const guessLetters = normalizedGuess.split('');
    const letterCounts = {};
    
    // Count letters in the target word
    for (const letter of wordLetters) {
      letterCounts[letter] = (letterCounts[letter] || 0) + 1;
    }
    
    // First pass: mark correct positions (green)
    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === wordLetters[i]) {
        result[i] = { letter: guessLetters[i], status: 'correct' };
        letterCounts[guessLetters[i]]--;
      }
    }
    
    // Second pass: mark present (yellow) or absent (gray)
    for (let i = 0; i < 5; i++) {
      if (result[i]) continue; // Already marked as correct
      
      if (letterCounts[guessLetters[i]] > 0) {
        result[i] = { letter: guessLetters[i], status: 'present' };
        letterCounts[guessLetters[i]]--;
      } else {
        result[i] = { letter: guessLetters[i], status: 'absent' };
      }
    }
    
    const isCorrect = normalizedGuess === todayWord;
    
    res.json({
      result,
      isCorrect,
      // Only reveal the word if guessed correctly
      ...(isCorrect && { word: todayWord })
    });
  } catch (err) {
    console.error("Error in /wordle/check:", err);
    res.status(500).json({ error: "Failed to check guess" });
  }
});

// Get all valid wordle words (for client-side validation)
router.get("/wordle/words", async (req, res) => {
  try {
    res.json({ words: Array.from(VALID_WORDLE_INPUTS) });
  } catch (err) {
    console.error("Error in /wordle/words:", err);
    res.status(500).json({ error: "Failed to get words" });
  }
});

// Reveal today's wordle word (for game over)
router.get("/wordle/reveal", async (req, res) => {
  try {
    const timezoneOffset = parseInt(req.query.offset) || 0;
    const now = new Date();
    const userLocalTime = new Date(now.getTime() + timezoneOffset * 60000);
    
    const year = userLocalTime.getUTCFullYear();
    const month = userLocalTime.getUTCMonth() + 1;
    const day = userLocalTime.getUTCDate();
    
    const seed = `wordle${year}${month}${day}`;
    const rng = seedrandom(seed);
    const index = Math.floor(rng() * WORDLE_ANSWERS.length);
    const todayWord = WORDLE_ANSWERS[index];
    
    res.json({ word: todayWord });
  } catch (err) {
    console.error("Error in /wordle/reveal:", err);
    res.status(500).json({ error: "Failed to reveal word" });
  }
});


router.post('/bug-report', async (req, res) => {
  const { message, modes } = req.body;

  if (!message || !modes?.length) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

    // POST /api/bug-report: Save bug report to database
    try {
      // Insert bug report into the database
      const insertQuery = `
        INSERT INTO bug_reports (message, modes, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id;
      `;
      // Store modes as JSON array
      const result = await pool.query(insertQuery, [message, modes]);
      res.status(201).json({ success: true, id: result.rows[0].id });
    } catch (err) {
      console.error("Error saving bug report:", err);
      res.status(500).json({ error: "Failed to save bug report." });
    }
  });


// GET /api/mapguesser/maps - Returns all available map names from subfolders
router.get('/mapguesser/maps', (req, res) => {
  try {
    // Read all subdirectories in the screenshots folder
    const entries = fsSync.readdirSync(SCREENSHOTS_DIR, { withFileTypes: true });
    const mapFolders = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    const maps = mapFolders.map(folderName => ({
      id: folderName.toLowerCase().replace(/\s+/g, '-'),
      name: folderName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: `/api/mapguesser/icon/${folderName}`
    }));
    
    res.json({ maps });
  } catch (err) {
    console.error('Error fetching maps:', err);
    res.status(500).json({ error: 'Failed to fetch maps', details: err.message });
  }
});

// GET /api/mapguesser/random?count=2&difficulty=medium
router.get('/mapguesser/random', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 2, 3);
    const difficulty = req.query.difficulty || 'medium';
    
    // Get all map subfolders
    const entries = fsSync.readdirSync(SCREENSHOTS_DIR, { withFileTypes: true });
    const mapFolders = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    if (mapFolders.length === 0) {
      return res.status(404).json({ error: 'No map folders found' });
    }
    
    // Pick random map folder
    const randomMap = mapFolders[Math.floor(Math.random() * mapFolders.length)];
    const mapFolderPath = path.join(SCREENSHOTS_DIR, randomMap);
    
    // Get all screenshots in this map's folder
    const files = fsSync.readdirSync(mapFolderPath)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'No screenshots found for this map' });
    }
    
    // Pick random screenshots
    const shuffled = files.sort(() => Math.random() - 0.5);
    const selectedFiles = shuffled.slice(0, Math.min(count, files.length));
    
    // Generate unique snippet IDs with random crop positions
    const snippets = selectedFiles.map((file, i) => {
      const snippetId = `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id: snippetId,
        // Include map folder in URL path
        url: `/api/mapguesser/snippet/${randomMap}/${file}?seed=${snippetId}&difficulty=${difficulty}`
      };
    });
    
    res.json({
      mapName: randomMap.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      snippets
    });
  } catch (err) {
    console.error('Error fetching random map:', err);
    res.status(500).json({ error: 'Failed to fetch random map', details: err.message });
  }
});

// GET /api/mapguesser/snippet/:mapFolder/:filename - Serve cropped, compressed snippet
router.get('/mapguesser/snippet/:mapFolder/:filename', async (req, res) => {
  try {
    const { mapFolder, filename } = req.params;
    const { seed, difficulty = 'medium' } = req.query;
    
    const filePath = path.join(SCREENSHOTS_DIR, mapFolder, filename);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Get image metadata
    const image = sharp(filePath);
    const metadata = await image.metadata();
    const { width, height } = metadata;
    
    // Calculate safe zone (excluding HUD)
    const safeZone = {
      left: Math.floor(width * HUD_MARGINS.left),
      top: Math.floor(height * HUD_MARGINS.top),
      right: Math.floor(width * (1 - HUD_MARGINS.right)),
      bottom: Math.floor(height * (1 - HUD_MARGINS.bottom))
    };
    
    const safeWidth = safeZone.right - safeZone.left;
    const safeHeight = safeZone.bottom - safeZone.top;
    
    // Get snippet size for difficulty
    const snippetSize = SNIPPET_SIZES[difficulty] || SNIPPET_SIZES.medium;
    
    // Use seed to generate consistent random position
    const seededRandom = (seed) => {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash % 1000) / 1000;
    };
    
    // Random position within safe zone
    const maxX = safeWidth - snippetSize.width;
    const maxY = safeHeight - snippetSize.height;
    
    const cropX = safeZone.left + Math.floor(seededRandom(seed + 'x') * maxX);
    const cropY = safeZone.top + Math.floor(seededRandom(seed + 'y') * maxY);
    
    // Crop and compress
    const croppedImage = await sharp(filePath)
      .extract({
        left: cropX,
        top: cropY,
        width: snippetSize.width,
        height: snippetSize.height
      })
      .webp({ quality: 80 }) // WebP is much smaller than PNG!
      .toBuffer();
    
    // Cache headers for performance
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    });
    
    res.send(croppedImage);
  } catch (err) {
    console.error('Error generating snippet:', err);
    res.status(500).json({ error: 'Failed to generate snippet' });
  }
});


export default router;
