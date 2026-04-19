import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://azsjbymrxcchmkidkioc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6c2pieW1yeGNjaG1raWRraW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NzYxNDIsImV4cCI6MjA5MjA1MjE0Mn0.5SNOiVCi0xec4uTom-aCVy_OEOCyKzyo61zSI_l4CAk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
