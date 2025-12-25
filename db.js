import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  host: 'localhost',
  user: 'raider_user',
  password: 'raiderdle6438',
  database: 'raiderdle',
  port: 5432,
});