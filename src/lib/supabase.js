import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchLogs() {
  const { data, error } = await supabase
    .from("health_logs")
    .select("date, data")
    .order("date", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({ ...row.data, date: row.date }));
}

export async function fetchSettings() {
  const { data, error } = await supabase
    .from("health_settings")
    .select("key, data");
  if (error) throw error;
  const result = {};
  for (const row of data) result[row.key] = row.data;
  return result._settings || {};
}

export async function upsertLog(entry) {
  const { error } = await supabase
    .from("health_logs")
    .upsert({ date: entry.date, data: entry, updated_at: new Date().toISOString() }, { onConflict: "date" });
  if (error) throw error;
}

export async function deleteLog(date) {
  const { error } = await supabase
    .from("health_logs")
    .delete()
    .eq("date", date);
  if (error) throw error;
}

export async function saveSettings(settings) {
  const { error } = await supabase
    .from("health_settings")
    .upsert({ key: "_settings", data: settings, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
