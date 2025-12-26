import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  host: 'localhost',
  user: 'raiderdle_user',
  password: 'raiderdle6438',
  database: 'bugs',
  port: 5432,
});