import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kbtpdqsqhwfsohyibunn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dFk-YZrP1nSblEeMl9lz2A_kmprIyo4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
