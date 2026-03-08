import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "healthlog_v3";
const SETTINGS_KEY = "healthlog_settings";
const todayStr = () => new Date().toISOString().split("T")[0];

const defaultEntry = (date = todayStr()) => ({
  id: Date.now(), date,
  steps: "", weight: "", exercise: false,
  bedtime: "", wakeup: "", sleepQuality: 3,
  sittingTime: null,
  breakfast: false, water: "", coffee: 0,
  wellbeing: 3, mood: 3,
  eyeFatigue: 3, neckShoulder: 3,
  overtime: "", wentOutside: null, focusPeak: null,
  memo: "",
});

// ─── utils ───────────────────────────────────────────────
function calcSleep(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let m = (wh * 60 + wm) - (bh * 60 + bm);
  if (m < 0) m += 1440;
  return +(m / 60).toFixed(1);
}

function sevenDayAvg(logs, field) {
  const vals = logs.slice(0, 7).map(l => parseFloat(l[field])).filter(v => !isNaN(v));
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

// Fix: 朝食と水分を別項目に、waterの二重カウント解消
function completion(e) {
  const checks = [
    !!e.steps,
    !!e.weight,
    !!(e.bedtime && e.wakeup),
    e.breakfast === true,
    !!e.water,
    e.sittingTime !== null,
    e.wentOutside !== null,
  ];
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

function calcStreak(logs) {
  if (!logs.length) return 0;
  const sorted = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  let cursor = new Date(todayStr() + "T00:00:00");
  for (const log of sorted) {
    const logDate = new Date(log.date + "T00:00:00");
    const diff = Math.round((cursor - logDate) / (1000 * 60 * 60 * 24));
    if (diff === 0 || diff === 1) {
      streak++;
      cursor = logDate;
    } else {
      break;
    }
  }
  return streak;
}

function calcBMI(weight, height) {
  if (!weight || !height) return null;
  const h = parseFloat(height) / 100;
  return +(parseFloat(weight) / (h * h)).toFixed(1);
}

function generateXPost(entry, avg7weight) {
  const sh = calcSleep(entry.bedtime, entry.wakeup);
  const lines = [`📅 ${entry.date} の健康ログ\n`];
  if (entry.steps) lines.push(`🚶 歩数: ${Number(entry.steps).toLocaleString()}歩 ${Number(entry.steps) >= 7000 ? "✅" : "△"}`);
  if (sh) lines.push(`🌙 睡眠: ${sh}h ${["😴","😕","😐","😊","🌟"][entry.sleepQuality - 1]} ${sh >= 7 ? "✅" : sh >= 6 ? "△" : "⚠️"}`);
  if (entry.weight) {
    const diff = avg7weight ? +(parseFloat(entry.weight) - avg7weight).toFixed(1) : null;
    lines.push(`⚖️ 体重: ${entry.weight}kg${diff !== null ? ` (7日比 ${diff > 0 ? "+" : ""}${diff})` : ""}`);
  }
  if (entry.sittingTime) {
    const labels = { low: "〜6h", mid: "6〜8h", high: "8〜10h", very_high: "10h+" };
    lines.push(`🪑 座位時間: ${labels[entry.sittingTime]} ${entry.sittingTime === "low" ? "✅" : entry.sittingTime === "mid" ? "△" : "⚠️"}`);
  }
  if (entry.water) lines.push(`💧 水分: ${entry.water}L ${parseFloat(entry.water) >= 2 ? "✅" : "△"}`);
  if (entry.coffee > 0) lines.push(`☕ コーヒー: ${entry.coffee}杯`);
  lines.push("");
  lines.push(`👁 眼精疲労: ${["😵 限界","😣 つらい","😐 普通","😌 良好","✨ 快調"][entry.eyeFatigue - 1]}`);
  lines.push(`💆 肩首こり: ${["🔴 激痛","🟠 痛い","🟡 少し","🟢 軽い","💚 なし"][entry.neckShoulder - 1]}`);
  lines.push(`🌈 ウェルビーイング: ${["😞","😟","😐","🙂","😄"][entry.wellbeing - 1]} ${entry.wellbeing}/5`);
  if (entry.overtime) lines.push(`⏰ 残業: ${entry.overtime}h`);
  if (entry.wentOutside !== null) lines.push(`🌤 昼外出: ${entry.wentOutside ? "✅" : "❌"}`);
  if (entry.memo) lines.push(`\n💬 ${entry.memo}`);
  lines.push("\n#デスクワーカー健康記録 #会計士の健康管理 #科学的健康習慣");
  return lines.join("\n");
}

// ─── design system ────────────────────────────────────────
const C = {
  bg: "#070c12",
  surface: "rgba(255,255,255,0.035)",
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(99,235,172,0.3)",
  green: "#63ebac",
  greenDim: "rgba(99,235,172,0.12)",
  yellow: "#fbbf24",
  red: "#f87171",
  orange: "#fb923c",
  text: "#f1f5f9",
  muted: "#64748b",
  mutedLight: "#94a3b8",
};

// ─── Static item arrays (moved outside component to avoid re-creation each render) ───
const SLEEP_ITEMS = [
  { emoji: "😴", label: "最悪", color: C.red },
  { emoji: "😕", label: "悪い", color: C.orange },
  { emoji: "😐", label: "普通", color: C.yellow },
  { emoji: "😊", label: "良い", color: "#86efac" },
  { emoji: "🌟", label: "最高", color: C.green },
];
const WELLBEING_ITEMS = [
  { emoji: "😞", label: "とても低い", color: C.red },
  { emoji: "😟", label: "低い", color: C.orange },
  { emoji: "😐", label: "普通", color: C.yellow },
  { emoji: "🙂", label: "高い", color: "#86efac" },
  { emoji: "😄", label: "とても高い", color: C.green },
];
const MOOD_ITEMS = [
  { emoji: "🌧", label: "最悪", color: C.red },
  { emoji: "🌥", label: "悪い", color: C.orange },
  { emoji: "⛅", label: "普通", color: C.yellow },
  { emoji: "🌤", label: "良い", color: "#86efac" },
  { emoji: "☀️", label: "最高", color: C.green },
];
const EYE_ITEMS = [
  { emoji: "😵", label: "限界", color: C.red },
  { emoji: "😣", label: "つらい", color: C.orange },
  { emoji: "😐", label: "普通", color: C.yellow },
  { emoji: "😌", label: "良好", color: "#86efac" },
  { emoji: "✨", label: "快調", color: C.green },
];
const NECK_ITEMS = [
  { emoji: "🔴", label: "激痛", color: C.red },
  { emoji: "🟠", label: "痛い", color: C.orange },
  { emoji: "🟡", label: "少し", color: C.yellow },
  { emoji: "🟢", label: "軽い", color: "#86efac" },
  { emoji: "💚", label: "なし", color: C.green },
];

// ─── micro components ─────────────────────────────────────
const Syne = ({ children, style }) => <span style={{ fontFamily: "'Syne', sans-serif", ...style }}>{children}</span>;

const Card = ({ children, style }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: "18px 16px", marginBottom: 12, ...style }}>
    {children}
  </div>
);

const CardHeader = ({ icon, title }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
    <span style={{ fontSize: "0.95rem" }}>{icon}</span>
    <Syne style={{ fontSize: "0.68rem", letterSpacing: "0.18em", color: C.green, textTransform: "uppercase", fontWeight: 800 }}>{title}</Syne>
  </div>
);

const Lbl = ({ children, hint }) => (
  <div style={{ marginBottom: 6 }}>
    <span style={{ fontSize: "0.76rem", color: C.mutedLight }}>{children}</span>
    {hint && <span style={{ fontSize: "0.66rem", color: C.muted, marginLeft: 6 }}>{hint}</span>}
  </div>
);

const Inp = ({ style, ...p }) => (
  <input {...p} style={{
    width: "100%", background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`,
    borderRadius: 10, padding: "9px 12px", color: C.text, fontSize: "0.88rem",
    outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif",
    transition: "border-color 0.2s", ...style,
  }}
    onFocus={e => e.target.style.borderColor = "rgba(99,235,172,0.45)"}
    onBlur={e => e.target.style.borderColor = C.border}
  />
);

// Fix: div → button with role="switch" for keyboard accessibility
const Toggle = ({ checked, onChange, label, activeColor = C.green }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11,
        background: checked ? activeColor : "rgba(255,255,255,0.07)",
        position: "relative", transition: "background 0.22s", flexShrink: 0,
        border: "none", cursor: "pointer", padding: 0,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: "50%",
        background: checked ? "#052e16" : "#475569",
        position: "absolute", top: 3,
        left: checked ? 21 : 3, transition: "left 0.22s",
      }} />
    </button>
    <span style={{ fontSize: "0.84rem", color: checked ? C.text : C.muted, transition: "color 0.2s" }}>{label}</span>
  </label>
);

const EmojiPicker = ({ value, onChange, items, label }) => (
  <div style={{ display: "flex", justifyContent: "space-between" }} role="radiogroup" aria-label={label}>
    {items.map((item, i) => {
      const active = i + 1 === value;
      return (
        <button
          key={i}
          onClick={() => onChange(i + 1)}
          role="radio"
          aria-checked={active}
          aria-label={item.label}
          style={{
            background: active ? `${item.color}18` : "transparent",
            border: `1px solid ${active ? item.color : C.border}`,
            borderRadius: 10, padding: "8px 0", flex: 1, margin: "0 2px",
            cursor: "pointer", transition: "all 0.15s", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          }}>
          <span style={{ fontSize: active ? "1.3rem" : "1rem", transition: "font-size 0.15s" }}>{item.emoji}</span>
          <span style={{ fontSize: "0.58rem", color: active ? item.color : C.muted, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>{item.label}</span>
        </button>
      );
    })}
  </div>
);

const ChipRow = ({ options, value, onChange, label }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label={label}>
    {options.map(opt => {
      const active = value === opt.value;
      return (
        <button
          key={opt.value}
          onClick={() => onChange(active ? null : opt.value)}
          aria-pressed={active}
          style={{
            padding: "7px 14px", borderRadius: 20,
            border: `1px solid ${active ? (opt.color || C.green) : C.border}`,
            background: active ? `${opt.color || C.green}15` : "transparent",
            color: active ? (opt.color || C.green) : C.muted,
            fontSize: "0.8rem", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
          }}>{opt.label}</button>
      );
    })}
  </div>
);

const Counter = ({ value, onChange, max = 6, unit, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <button
      onClick={() => onChange(Math.max(0, value - 1))}
      aria-label={`${label || unit}を減らす`}
      style={{
        width: 28, height: 28, borderRadius: "50%", border: `1px solid ${C.border}`,
        background: "rgba(255,255,255,0.04)", color: C.mutedLight, cursor: "pointer", fontSize: "1.1rem",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>−</button>
    <Syne style={{ minWidth: 32, textAlign: "center", fontWeight: 800, fontSize: "1.1rem", color: value > 0 ? C.yellow : C.muted }}>
      {value >= max ? `${max}+` : value}
    </Syne>
    <button
      onClick={() => onChange(Math.min(max, value + 1))}
      aria-label={`${label || unit}を増やす`}
      style={{
        width: 28, height: 28, borderRadius: "50%", border: `1px solid ${C.border}`,
        background: "rgba(255,255,255,0.04)", color: C.mutedLight, cursor: "pointer", fontSize: "1.1rem",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>＋</button>
    {unit && <span style={{ fontSize: "0.76rem", color: C.muted }}>{unit}</span>}
  </div>
);

// ─── mini sparkline ───────────────────────────────────────
const Sparkline = ({ data, color, height = 32, width = 80 }) => {
  const valid = data.filter(v => v != null);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = v != null ? height - ((v - min) / range) * (height - 4) - 2 : null;
    return y != null ? `${x},${y}` : null;
  }).filter(Boolean).join(" ");
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// ─── XPostPanel (extracted component, removes copied state from App) ──
const XPostPanel = ({ xPost, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!xPost) return null;
  return (
    <div style={{ marginTop: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Syne style={{ fontSize: "0.68rem", color: C.green, letterSpacing: "0.12em" }}>𝕏 DRAFT POST</Syne>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { navigator.clipboard.writeText(xPost); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            style={{
              padding: "4px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: copied ? C.greenDim : "transparent",
              color: copied ? C.green : C.muted, fontSize: "0.7rem",
              cursor: "pointer", fontFamily: "'Syne', sans-serif",
            }}>
            {copied ? "✅ コピー済" : "📋 コピー"}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="投稿文を閉じる"
              style={{
                padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
                background: "transparent", color: C.muted, fontSize: "0.7rem", cursor: "pointer",
              }}>✕</button>
          )}
        </div>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.85, margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
        {xPost}
      </pre>
    </div>
  );
};

// ─── tabs ─────────────────────────────────────────────────
const TABS = [["record","📝","TODAY"], ["insight","📊","INSIGHT"], ["history","🗂","LOG"], ["settings","⚙️","設定"]];

// ═══════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("record");
  const [entry, setEntry] = useState(defaultEntry());
  const [logs, setLogs] = useState([]);
  const [saved, setSaved] = useState(false);
  const [xPost, setXPost] = useState("");
  const [showX, setShowX] = useState(false);
  const [settings, setSettings] = useState({ height: "" });
  const [currentDate, setCurrentDate] = useState(todayStr());
  const importRef = useRef();

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setLogs(raw);
      const t = todayStr();
      const today = raw.find(l => l.date === t);
      if (today) setEntry(today);

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (saved.height) setSettings(saved);
    } catch {}
  }, []);

  // 日付跨ぎ検知: 1分ごとにチェックし、日付が変わったら今日エントリをリセット
  useEffect(() => {
    const interval = setInterval(() => {
      const now = todayStr();
      if (now !== currentDate) {
        setCurrentDate(now);
        setEntry(prev => prev.date === currentDate ? defaultEntry(now) : prev);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDate]);

  const set = (k, v) => setEntry(p => ({ ...p, [k]: v }));
  const isEditingToday = entry.date === currentDate;

  const handleSave = () => {
    const updated = [entry, ...logs.filter(l => l.date !== entry.date)].sort((a, b) => b.date.localeCompare(a.date));
    setLogs(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const handleDelete = (date) => {
    if (!window.confirm(`${date} の記録を削除しますか？`)) return;
    const updated = logs.filter(l => l.date !== date);
    setLogs(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    if (entry.date === date) setEntry(defaultEntry());
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ logs, exportedAt: new Date().toISOString(), version: "v3" }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `healthlog_${currentDate}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        const imported = data.logs || data;
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        // 既存データとマージ（日付重複は既存を優先）
        const merged = [...logs];
        imported.forEach(log => { if (!merged.find(l => l.date === log.date)) merged.push(log); });
        merged.sort((a, b) => b.date.localeCompare(a.date));
        setLogs(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        alert(`${imported.length}件のデータをインポートしました`);
      } catch {
        alert("インポートに失敗しました。ファイル形式を確認してください。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  };

  // 週次Xポスト生成: setTimeout+タブ切り替えを廃止、Insightタブ内で完結
  const generateWeeklyPost = () => {
    const avg = {
      steps: sevenDayAvg(logs.slice(0, 7), "steps"),
      sleep: (() => { const s = logs.slice(0, 7).map(l => calcSleep(l.bedtime, l.wakeup)).filter(Boolean); return s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) : null; })(),
      water: sevenDayAvg(logs.slice(0, 7), "water"),
      wellbeing: sevenDayAvg(logs.slice(0, 7), "wellbeing"),
      mood: sevenDayAvg(logs.slice(0, 7), "mood"),
      exerciseDays: logs.slice(0, 7).filter(l => l.exercise).length,
      outsideDays: logs.slice(0, 7).filter(l => l.wentOutside).length,
    };
    const focusCounts = { morning: 0, afternoon: 0, evening: 0 };
    logs.slice(0, 7).forEach(l => { if (l.focusPeak) focusCounts[l.focusPeak]++; });
    const topFocus = Object.entries(focusCounts).sort((a, b) => b[1] - a[1])[0];
    return [
      `📊 今週の健康ログ週次レポート\n`,
      avg.steps ? `🚶 平均歩数: ${Number(avg.steps).toLocaleString()}歩 ${avg.steps >= 7000 ? "✅" : "△"}` : "",
      avg.sleep ? `🌙 平均睡眠: ${avg.sleep}h ${avg.sleep >= 7 ? "✅" : "△"}` : "",
      avg.water ? `💧 平均水分: ${avg.water}L` : "",
      `💪 運動日数: ${avg.exerciseDays}/7日`,
      `🌤 昼外出: ${avg.outsideDays}/7日`,
      avg.wellbeing ? `🌈 ウェルビーイング平均: ${avg.wellbeing}/5` : "",
      avg.mood ? `😊 気分平均: ${avg.mood}/5` : "",
      topFocus && topFocus[1] > 0 ? `⚡ 集中ピーク: ${{"morning":"午前🌅","afternoon":"午後🌞","evening":"夕方🌆"}[topFocus[0]]}が多い` : "",
      streak > 1 ? `🔥 連続記録: ${streak}日` : "",
      `\n#デスクワーカー健康記録 #週次レポート #会計士の健康管理`,
    ].filter(Boolean).join("\n");
  };

  const sleepH = calcSleep(entry.bedtime, entry.wakeup);
  const avg7w = sevenDayAvg(logs.filter(l => l.date !== entry.date), "weight");
  const comp = completion(entry);
  const streak = calcStreak(logs);
  const bmi = calcBMI(entry.weight, settings.height);

  // Insight data
  const last14 = logs.slice(0, 14).reverse();
  const stepsData = last14.map(l => l.steps ? parseInt(l.steps) : null);
  const sleepData = last14.map(l => calcSleep(l.bedtime, l.wakeup));
  const weightData = last14.map(l => l.weight ? parseFloat(l.weight) : null);
  const wellbeingData = last14.map(l => l.wellbeing);

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif", paddingBottom: 80 }}>

        {/* ── Header ── */}
        <div style={{
          padding: "18px 20px 14px", borderBottom: `1px solid rgba(99,235,172,0.1)`,
          position: "sticky", top: 0, zIndex: 30,
          background: "rgba(7,12,18,0.96)", backdropFilter: "blur(14px)",
        }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <Syne style={{ fontWeight: 800, fontSize: "1.25rem", letterSpacing: "-0.02em" }}>
                  Health<span style={{ color: C.green }}>Log</span>
                </Syne>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                  <div style={{ fontSize: "0.65rem", color: C.muted, letterSpacing: "0.12em" }}>
                    DESK WORKER · ACCOUNTANT · EVIDENCE-BASED
                  </div>
                  {streak > 1 && (
                    <span style={{ fontSize: "0.65rem", color: C.orange, fontWeight: 700 }}>🔥 {streak}日連続</span>
                  )}
                </div>
              </div>
              {tab === "record" && (
                <div style={{ textAlign: "right" }}>
                  <Syne style={{ fontWeight: 800, fontSize: "1.4rem", color: comp >= 80 ? C.green : comp >= 50 ? C.yellow : C.text }}>
                    {comp}<span style={{ fontSize: "0.65rem", color: C.muted, fontWeight: 400 }}>%</span>
                  </Syne>
                  <div style={{ fontSize: "0.6rem", color: C.muted, letterSpacing: "0.1em" }}>COMPLETE</div>
                </div>
              )}
              {tab === "insight" && sleepH && (
                <div style={{ textAlign: "right" }}>
                  <Syne style={{ fontWeight: 800, fontSize: "1.1rem", color: sleepH >= 7 ? C.green : sleepH >= 6 ? C.yellow : C.red }}>
                    {sleepH}h
                  </Syne>
                  <div style={{ fontSize: "0.6rem", color: C.muted, letterSpacing: "0.1em" }}>SLEEP</div>
                </div>
              )}
            </div>
            {tab === "record" && (
              <div style={{ marginTop: 10, height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${comp}%`, background: `linear-gradient(90deg, ${C.green}, #a3e635)`, transition: "width 0.35s ease" }} />
              </div>
            )}
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div style={{ borderBottom: `1px solid rgba(255,255,255,0.05)`, background: "rgba(7,12,18,0.8)" }}>
          <div style={{ maxWidth: 480, margin: "0 auto", display: "flex" }} role="tablist">
            {TABS.map(([id, icon, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={{
                flex: 1, padding: "11px 0", border: "none", background: "transparent",
                color: tab === id ? C.green : C.muted,
                fontSize: "0.68rem", fontFamily: "'Syne', sans-serif", fontWeight: 800,
                letterSpacing: "0.1em", cursor: "pointer",
                borderBottom: tab === id ? `2px solid ${C.green}` : "2px solid transparent",
                transition: "all 0.2s",
              }}>{icon} {label}</button>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 14px" }}>

          {/* ════════════ TODAY TAB ════════════ */}
          {tab === "record" && (<>

            {/* 過去日編集中の警告バナー */}
            {!isEditingToday && (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", marginBottom: 12,
                background: "rgba(251,191,36,0.06)", border: `1px solid rgba(251,191,36,0.25)`, borderRadius: 12,
              }}>
                <span style={{ fontSize: "0.75rem", color: C.yellow }}>⚠️ 過去の記録を編集中: {entry.date}</span>
                <button
                  onClick={() => setEntry(logs.find(l => l.date === currentDate) || defaultEntry())}
                  style={{
                    fontSize: "0.7rem", color: C.green, background: "transparent",
                    border: `1px solid ${C.green}40`, borderRadius: 8, padding: "3px 10px", cursor: "pointer",
                  }}>今日に戻る</button>
              </div>
            )}

            {/* 日付 */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", marginBottom: 12,
              background: `rgba(99,235,172,0.04)`, border: `1px solid rgba(99,235,172,0.12)`, borderRadius: 12,
            }}>
              <input type="date" value={entry.date} onChange={e => set("date", e.target.value)} aria-label="記録日付" style={{
                background: "transparent", border: "none", color: C.green,
                fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer",
              }} />
              {sleepH && <Syne style={{ fontWeight: 800, fontSize: "1rem", color: sleepH >= 7 ? C.green : sleepH >= 6 ? C.yellow : C.red }}>
                {sleepH}h <span style={{ fontSize: "0.6rem", color: C.muted, fontWeight: 400 }}>sleep</span>
              </Syne>}
            </div>

            {/* Body */}
            <Card>
              <CardHeader icon="🏃" title="Body — 身体活動" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <Lbl hint="≥7,000で✅（Lancet 2025）">歩数</Lbl>
                  <Inp type="number" placeholder="例: 8000" value={entry.steps} onChange={e => set("steps", e.target.value)} aria-label="歩数" />
                  {entry.steps && <div style={{ fontSize: "0.65rem", marginTop: 4, color: parseInt(entry.steps) >= 7000 ? C.green : parseInt(entry.steps) >= 4000 ? C.yellow : C.red }}>
                    {parseInt(entry.steps) >= 7000 ? "✅ 目標達成" : parseInt(entry.steps) >= 4000 ? "△ 最小有効量以上" : "⚠️ 4,000歩以下"}
                  </div>}
                </div>
                <div>
                  <Lbl hint={avg7w ? `7日平均 ${avg7w}kg` : "7日平均を計算中"}>体重 (kg)</Lbl>
                  <Inp type="number" step="0.1" placeholder="65.0" value={entry.weight} onChange={e => set("weight", e.target.value)} aria-label="体重" />
                  {entry.weight && avg7w && <div style={{ fontSize: "0.65rem", marginTop: 4, color: parseFloat(entry.weight) < avg7w ? C.green : parseFloat(entry.weight) > avg7w ? C.orange : C.muted }}>
                    {parseFloat(entry.weight) < avg7w ? `▼ ${+(parseFloat(entry.weight) - avg7w).toFixed(1)}kg` : parseFloat(entry.weight) > avg7w ? `▲ +${+(parseFloat(entry.weight) - avg7w).toFixed(1)}kg` : "→ 平均と同じ"}
                  </div>}
                  {bmi && <div style={{ fontSize: "0.65rem", marginTop: 2, color: bmi < 18.5 ? C.yellow : bmi < 25 ? C.green : bmi < 30 ? C.orange : C.red }}>
                    BMI {bmi} — {bmi < 18.5 ? "低体重" : bmi < 25 ? "標準" : bmi < 30 ? "過体重" : "肥満"}
                  </div>}
                </div>
              </div>
              <Toggle checked={entry.exercise} onChange={v => set("exercise", v)} label="今日は運動した（WHO推奨 150分/週）💪" />
            </Card>

            {/* Sleep */}
            <Card>
              <CardHeader icon="🌙" title="Sleep — 睡眠" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div><Lbl>就寝</Lbl><Inp type="time" value={entry.bedtime} onChange={e => set("bedtime", e.target.value)} aria-label="就寝時刻" /></div>
                <div><Lbl>起床</Lbl><Inp type="time" value={entry.wakeup} onChange={e => set("wakeup", e.target.value)} aria-label="起床時刻" /></div>
              </div>
              {sleepH && (
                <div style={{
                  padding: "8px 12px", borderRadius: 8, marginBottom: 14,
                  background: sleepH >= 7 ? "rgba(99,235,172,0.07)" : sleepH >= 6 ? "rgba(251,191,36,0.07)" : "rgba(248,113,113,0.07)",
                  border: `1px solid ${sleepH >= 7 ? C.green : sleepH >= 6 ? C.yellow : C.red}30`,
                  fontSize: "0.75rem",
                  color: sleepH >= 7 ? C.green : sleepH >= 6 ? C.yellow : C.red,
                }}>
                  {sleepH >= 7 ? `✅ ${sleepH}h — U字型最適域（7h〜）に到達` : sleepH >= 6 ? `△ ${sleepH}h — 目標まであと${(7 - sleepH).toFixed(1)}h` : `⚠️ ${sleepH}h — 死亡リスク上昇域（JAHA 2018）`}
                </div>
              )}
              <Lbl>睡眠の質（厚労省 睡眠ガイド2023準拠）</Lbl>
              <EmojiPicker value={entry.sleepQuality} onChange={v => set("sleepQuality", v)} items={SLEEP_ITEMS} label="睡眠の質" />
            </Card>

            {/* Sitting */}
            <Card>
              <CardHeader icon="🪑" title="Sedentary — 座位時間" />
              <Lbl hint="100万人メタ解析（BMC Medicine）">本日の合計座位時間（推定）</Lbl>
              <div style={{ display: "flex", gap: 6 }} role="group" aria-label="座位時間">
                {[
                  { value: "low", label: "〜6h", color: C.green, hint: "✅" },
                  { value: "mid", label: "6〜8h", color: C.yellow, hint: "△" },
                  { value: "high", label: "8〜10h", color: C.orange, hint: "⚠" },
                  { value: "very_high", label: "10h+", color: C.red, hint: "🔥" },
                ].map(opt => {
                  const active = entry.sittingTime === opt.value;
                  return (
                    <button key={opt.value} onClick={() => set("sittingTime", active ? null : opt.value)}
                      aria-pressed={active} aria-label={`座位時間 ${opt.label}`}
                      style={{
                        flex: 1, padding: "9px 0", borderRadius: 10, cursor: "pointer",
                        border: `1px solid ${active ? opt.color : C.border}`,
                        background: active ? `${opt.color}18` : "transparent",
                        color: active ? opt.color : C.muted,
                        fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      }}>
                      <span style={{ fontSize: "0.7rem", fontWeight: 600 }}>{opt.hint}</span>
                      <span style={{ fontSize: "0.75rem" }}>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Food */}
            <Card>
              <CardHeader icon="🍱" title="Food & Hydration — 食事・水分" />
              <div style={{ marginBottom: 14 }}>
                <Toggle checked={entry.breakfast} onChange={v => set("breakfast", v)} label="朝食あり（体内時計リセット：時間栄養学）" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <Lbl hint="男性推奨 ≥2L（IOM）">水分 (L)</Lbl>
                  <Inp type="number" step="0.1" placeholder="2.0" value={entry.water} onChange={e => set("water", e.target.value)} aria-label="水分摂取量" />
                  {entry.water && <div style={{ fontSize: "0.65rem", marginTop: 4, color: parseFloat(entry.water) >= 2 ? C.green : C.yellow }}>
                    {parseFloat(entry.water) >= 2 ? "✅ 推奨量到達" : `△ あと${(2 - parseFloat(entry.water)).toFixed(1)}L`}
                  </div>}
                </div>
                <div>
                  <Lbl hint="睡眠6h前以降は避けると◎">コーヒー杯数 ☕</Lbl>
                  <div style={{ marginTop: 8 }}><Counter value={entry.coffee} onChange={v => set("coffee", v)} max={6} unit="杯" label="コーヒー" /></div>
                </div>
              </div>
            </Card>

            {/* Wellbeing */}
            <Card>
              <CardHeader icon="🌈" title="Wellbeing — 主観的健康" />
              <div style={{ marginBottom: 16 }}>
                <Lbl hint="WHO-5準拠 — 低値は抑うつスクリーニングの指標">ウェルビーイング（全体的な良い状態）</Lbl>
                <EmojiPicker value={entry.wellbeing} onChange={v => set("wellbeing", v)} items={WELLBEING_ITEMS} label="ウェルビーイング" />
              </div>
              <div>
                <Lbl hint="PHQ-9準拠の日次気分トラッキング">今日の気分</Lbl>
                <EmojiPicker value={entry.mood} onChange={v => set("mood", v)} items={MOOD_ITEMS} label="今日の気分" />
              </div>
            </Card>

            {/* Desk strain */}
            <Card>
              <CardHeader icon="💆" title="Desk Strain — デスク疲労" />
              <div style={{ marginBottom: 14 }}>
                <Lbl hint="VDT症候群指標">👁 眼精疲労</Lbl>
                <EmojiPicker value={entry.eyeFatigue} onChange={v => set("eyeFatigue", v)} items={EYE_ITEMS} label="眼精疲労" />
              </div>
              <div>
                <Lbl hint="VDT症候群指標">💆 肩・首こり</Lbl>
                <EmojiPicker value={entry.neckShoulder} onChange={v => set("neckShoulder", v)} items={NECK_ITEMS} label="肩首こり" />
              </div>
            </Card>

            {/* Work */}
            <Card>
              <CardHeader icon="💼" title="Work — 仕事" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <Lbl hint="過労死ライン目安: 月80h">残業時間 (h)</Lbl>
                  <Inp type="number" step="0.5" placeholder="0" value={entry.overtime} onChange={e => set("overtime", e.target.value)} aria-label="残業時間" />
                </div>
                <div>
                  <Lbl hint="日光・セロトニン合成">昼外出</Lbl>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }} role="group" aria-label="昼外出">
                    {[{ v: true, l: "✅ した", c: C.green }, { v: false, l: "❌ なし", c: C.red }].map(opt => (
                      <button key={String(opt.v)} onClick={() => set("wentOutside", entry.wentOutside === opt.v ? null : opt.v)}
                        aria-pressed={entry.wentOutside === opt.v}
                        style={{
                          flex: 1, padding: "8px 0", borderRadius: 10, cursor: "pointer",
                          border: `1px solid ${entry.wentOutside === opt.v ? opt.c : C.border}`,
                          background: entry.wentOutside === opt.v ? `${opt.c}15` : "transparent",
                          color: entry.wentOutside === opt.v ? opt.c : C.muted,
                          fontSize: "0.78rem", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                        }}>{opt.l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <Lbl hint="クロノタイプ研究 — 自分のパフォーマンスパターンを把握">⚡ 集中ピーク時間帯</Lbl>
                <ChipRow
                  options={[
                    { value: "morning", label: "🌅 午前", color: C.yellow },
                    { value: "afternoon", label: "🌞 午後", color: C.orange },
                    { value: "evening", label: "🌆 夕方", color: "#a78bfa" },
                  ]}
                  value={entry.focusPeak}
                  onChange={v => set("focusPeak", v)}
                  label="集中ピーク時間帯"
                />
              </div>
            </Card>

            {/* Note */}
            <Card>
              <CardHeader icon="✏️" title="Note — 今日のひとこと" />
              <textarea value={entry.memo} onChange={e => set("memo", e.target.value)}
                placeholder="気づいたこと、Xに投稿したいひとこと..."
                aria-label="メモ"
                rows={3} style={{
                  width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: "0.85rem",
                  outline: "none", resize: "vertical", boxSizing: "border-box",
                  fontFamily: "'DM Sans', sans-serif", lineHeight: 1.7,
                }} />
            </Card>

            <button onClick={handleSave} style={{
              width: "100%", padding: 14, borderRadius: 14, border: "none",
              background: saved ? "#22c55e" : `linear-gradient(135deg, ${C.green}, #a3e635)`,
              color: saved ? "#fff" : "#052e16",
              fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "0.88rem",
              letterSpacing: "0.08em", cursor: "pointer", marginBottom: 10, transition: "all 0.25s",
            }}>
              {saved ? "✅ 保存しました" : "💾 今日の記録を保存"}
            </button>

            <button onClick={() => { setXPost(generateXPost(entry, avg7w)); setShowX(v => !v); }} style={{
              width: "100%", padding: 13, borderRadius: 14,
              border: `1px solid rgba(255,255,255,0.1)`, background: "rgba(255,255,255,0.03)",
              color: C.mutedLight, fontFamily: "'Syne', sans-serif", fontWeight: 700,
              fontSize: "0.82rem", cursor: "pointer", letterSpacing: "0.06em",
            }}>
              𝕏 投稿文を生成する
            </button>

            {showX && <XPostPanel xPost={xPost} onClose={() => setShowX(false)} />}
          </>)}

          {/* ════════════ INSIGHT TAB ════════════ */}
          {tab === "insight" && (<>
            {logs.length < 3 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted, fontSize: "0.85rem" }}>
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>📊</div>
                3日以上記録するとインサイトが表示されます
              </div>
            ) : (<>

              {/* 7日サマリー */}
              <Card>
                <CardHeader icon="📈" title="7-Day Summary — 週次サマリー" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "平均歩数", val: sevenDayAvg(logs.slice(0, 7), "steps"), unit: "歩", goal: 7000, data: stepsData.slice(-7), color: C.green },
                    { label: "平均睡眠", val: (() => { const s = logs.slice(0, 7).map(l => calcSleep(l.bedtime, l.wakeup)).filter(Boolean); return s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) : null; })(), unit: "h", goal: 7, data: sleepData.slice(-7), color: "#818cf8" },
                    { label: "体重7日平均", val: avg7w, unit: "kg", data: weightData.slice(-7), color: C.yellow },
                    { label: "平均ウェルビーイング", val: sevenDayAvg(logs.slice(0, 7), "wellbeing"), unit: "/5", goal: 4, data: wellbeingData.slice(-7), color: C.orange },
                  ].map((item, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ fontSize: "0.65rem", color: C.muted, marginBottom: 6 }}>{item.label}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <Syne style={{ fontWeight: 800, fontSize: "1.2rem", color: item.val && item.goal ? (item.val >= item.goal ? C.green : C.yellow) : C.text }}>
                          {item.val != null ? (Number.isInteger(item.val) ? item.val.toLocaleString() : item.val) : "—"}
                          <span style={{ fontSize: "0.65rem", color: C.muted, fontWeight: 400 }}>{item.unit}</span>
                        </Syne>
                        <Sparkline data={item.data} color={item.color} />
                      </div>
                      {item.val && item.goal && (
                        <div style={{ fontSize: "0.6rem", color: item.val >= item.goal ? C.green : C.yellow, marginTop: 4 }}>
                          {item.val >= item.goal ? "✅ 目標達成" : `△ 目標まで +${(item.goal - item.val).toFixed(1)}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>

              {/* 気分・集中インサイト (mood/focusPeak を活用) */}
              <Card>
                <CardHeader icon="🧠" title="Mood & Focus — 気分・集中" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: "0.65rem", color: C.muted, marginBottom: 6 }}>平均気分</div>
                    <Syne style={{ fontWeight: 800, fontSize: "1.2rem", color: C.text }}>
                      {sevenDayAvg(logs.slice(0, 7), "mood") ?? "—"}
                      <span style={{ fontSize: "0.65rem", color: C.muted, fontWeight: 400 }}>/5</span>
                    </Syne>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: "0.65rem", color: C.muted, marginBottom: 6 }}>集中ピーク傾向</div>
                    {(() => {
                      const counts = { morning: 0, afternoon: 0, evening: 0 };
                      logs.slice(0, 7).forEach(l => { if (l.focusPeak) counts[l.focusPeak]++; });
                      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                      return top && top[1] > 0 ? (
                        <Syne style={{ fontWeight: 800, fontSize: "0.95rem", color: C.yellow }}>
                          {{"morning":"🌅 午前","afternoon":"🌞 午後","evening":"🌆 夕方"}[top[0]]}
                          <span style={{ fontSize: "0.6rem", color: C.muted, fontWeight: 400 }}> {top[1]}日/7日</span>
                        </Syne>
                      ) : <span style={{ fontSize: "0.8rem", color: C.muted }}>データ不足</span>;
                    })()}
                  </div>
                </div>
                {(() => {
                  const avgMood = sevenDayAvg(logs.slice(0, 7), "mood");
                  const avgWell = sevenDayAvg(logs.slice(0, 7), "wellbeing");
                  if (!avgMood || !avgWell || Math.abs(avgMood - avgWell) < 0.5) return null;
                  const diff = +(avgMood - avgWell).toFixed(1);
                  return (
                    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", fontSize: "0.78rem", color: "#a78bfa" }}>
                      💡 気分({avgMood})とウェルビーイング({avgWell})に{Math.abs(diff)}ポイントの差があります。
                      {diff > 0 ? "感情は良好ですが体調面での改善余地があります。" : "体調は安定していますが感情面のサポートを意識しましょう。"}
                    </div>
                  );
                })()}
              </Card>

              {/* 相関インサイト */}
              <Card>
                <CardHeader icon="🔍" title="Correlations — 相関インサイト" />
                {(() => {
                  const insights = [];
                  const sleepArr = logs.slice(0, 14).map(l => calcSleep(l.bedtime, l.wakeup)).filter(Boolean);
                  const avgSleep = sleepArr.length ? sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length : null;
                  if (avgSleep && avgSleep < 6.5) insights.push({ emoji: "😴", text: `平均睡眠${avgSleep.toFixed(1)}hは不足傾向。JAHA研究では7h未満で死亡リスクが上昇。`, color: C.red });

                  const highCoffeeWithBadSleep = logs.slice(0, 7).filter(l => l.coffee >= 4 && calcSleep(l.bedtime, l.wakeup) < 6.5);
                  if (highCoffeeWithBadSleep.length >= 2) insights.push({ emoji: "☕", text: `コーヒー4杯以上の日に睡眠が短い傾向あり。睡眠6h前以降のカフェインに注意。`, color: C.orange });

                  const noOutside = logs.slice(0, 7).filter(l => l.wentOutside === false).length;
                  if (noOutside >= 4) insights.push({ emoji: "🌤", text: `直近7日中${noOutside}日外出なし。日光不足によるセロトニン低下に注意。`, color: C.yellow });

                  const highOvertime = logs.slice(0, 7).filter(l => parseFloat(l.overtime) > 2).length;
                  if (highOvertime >= 3) insights.push({ emoji: "⏰", text: `直近7日中${highOvertime}日で残業2h超。慢性的な過労は睡眠の質を低下させます。`, color: C.orange });

                  const lowWellbeing = logs.slice(0, 7).filter(l => l.wellbeing <= 2).length;
                  if (lowWellbeing >= 3) insights.push({ emoji: "🌈", text: `ウェルビーイングスコアが低い日が${lowWellbeing}日続いています。WHO-5でいう要注意水準。`, color: C.red });

                  const lowMoodDays = logs.slice(0, 5).filter(l => l.mood <= 2).length;
                  if (lowMoodDays >= 3) insights.push({ emoji: "😟", text: `気分スコアが低い日が${lowMoodDays}日続いています。医療専門家への相談を検討してください。`, color: C.red });

                  const overtimeWithMorningFocus = logs.slice(0, 14).filter(l => parseFloat(l.overtime) > 2 && l.focusPeak === "morning");
                  if (overtimeWithMorningFocus.length >= 3) insights.push({ emoji: "⚡", text: `残業が多い日も午前集中の傾向があります。残業削減で午前パフォーマンスがさらに向上する可能性があります。`, color: "#a78bfa" });

                  return insights.length ? insights.map((ins, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 10, marginBottom: 8, background: `${ins.color}10`, border: `1px solid ${ins.color}25` }}>
                      <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{ins.emoji}</span>
                      <span style={{ fontSize: "0.78rem", color: ins.color, lineHeight: 1.6 }}>{ins.text}</span>
                    </div>
                  )) : (
                    <div style={{ fontSize: "0.8rem", color: C.muted, textAlign: "center", padding: "16px 0" }}>
                      🎉 直近7日で特に気になるパターンはありません
                    </div>
                  );
                })()}
              </Card>

              {/* 週次Xポスト生成: タブ切り替え不要、Insightタブ内で完結 */}
              <button onClick={() => { setXPost(generateWeeklyPost()); setShowX(v => !v); }} style={{
                width: "100%", padding: 13, borderRadius: 14,
                border: `1px solid rgba(255,255,255,0.1)`, background: "rgba(255,255,255,0.03)",
                color: C.mutedLight, fontFamily: "'Syne', sans-serif", fontWeight: 700,
                fontSize: "0.82rem", cursor: "pointer", letterSpacing: "0.06em", marginBottom: 12,
              }}>
                𝕏 週次レポートを生成
              </button>
              {showX && <XPostPanel xPost={xPost} onClose={() => setShowX(false)} />}
            </>)}
          </>)}

          {/* ════════════ HISTORY TAB ════════════ */}
          {tab === "history" && (<>
            <div style={{ fontSize: "0.68rem", color: C.muted, letterSpacing: "0.1em", marginBottom: 12 }}>
              {logs.length} RECORDS
            </div>
            {logs.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: C.muted, fontSize: "0.85rem" }}>
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>🗂</div>
                まだ記録がありません
              </div>
            ) : (
              logs.map(log => {
                const sh = calcSleep(log.bedtime, log.wakeup);
                return (
                  <div key={log.id}
                    style={{
                      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                      padding: "14px 14px", marginBottom: 8, transition: "border-color 0.2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHover}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <Syne style={{ fontWeight: 800, color: C.green, fontSize: "0.88rem" }}>{log.date}</Syne>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {log.exercise && <span style={{ fontSize: "0.62rem", background: C.greenDim, color: C.green, padding: "2px 7px", borderRadius: 10 }}>運動</span>}
                        {log.wentOutside === false && <span style={{ fontSize: "0.62rem", background: "rgba(248,113,113,0.1)", color: C.red, padding: "2px 7px", borderRadius: 10 }}>外出なし</span>}
                        {log.sittingTime === "very_high" && <span style={{ fontSize: "0.62rem", background: "rgba(248,113,113,0.1)", color: C.red, padding: "2px 7px", borderRadius: 10 }}>座位10h+</span>}
                        {/* 削除ボタン */}
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(log.date); }}
                          aria-label={`${log.date}の記録を削除`}
                          style={{
                            background: "transparent", border: `1px solid rgba(248,113,113,0.25)`,
                            color: C.red, borderRadius: 6, padding: "2px 7px",
                            fontSize: "0.62rem", cursor: "pointer", marginLeft: 2,
                          }}>🗑</button>
                      </div>
                    </div>
                    <div
                      onClick={() => { setEntry(log); setTab("record"); setShowX(false); }}
                      style={{ cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {log.steps && <MiniStat label="歩数" val={`${Number(log.steps).toLocaleString()}`} color={parseInt(log.steps) >= 7000 ? C.green : parseInt(log.steps) >= 4000 ? C.yellow : C.red} />}
                        {sh && <MiniStat label="睡眠" val={`${sh}h`} color={sh >= 7 ? C.green : sh >= 6 ? C.yellow : C.red} />}
                        {log.weight && <MiniStat label="体重" val={`${log.weight}kg`} />}
                        {log.water && <MiniStat label="水分" val={`${log.water}L`} color={parseFloat(log.water) >= 2 ? C.green : C.yellow} />}
                        {log.coffee > 0 && <MiniStat label="☕" val={`${log.coffee}杯`} color={C.yellow} />}
                        <MiniStat label="眼" val={["😵","😣","😐","😌","✨"][log.eyeFatigue - 1]} />
                        <MiniStat label="肩首" val={["🔴","🟠","🟡","🟢","💚"][log.neckShoulder - 1]} />
                        <MiniStat label="🌈" val={`${log.wellbeing}/5`} color={log.wellbeing >= 4 ? C.green : log.wellbeing <= 2 ? C.red : C.yellow} />
                        <MiniStat label="気分" val={["🌧","🌥","⛅","🌤","☀️"][log.mood - 1]} />
                        {log.overtime && <MiniStat label="残業" val={`${log.overtime}h`} color={parseFloat(log.overtime) > 2 ? C.orange : C.text} />}
                      </div>
                      {log.memo && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid rgba(255,255,255,0.04)`, fontSize: "0.72rem", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          💬 {log.memo}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>)}

          {/* ════════════ SETTINGS TAB ════════════ */}
          {tab === "settings" && (
            <SettingsPanel
              settings={settings}
              onSave={handleSaveSettings}
              onExport={handleExport}
              onImport={() => importRef.current.click()}
              logsCount={logs.length}
            />
          )}
        </div>
      </div>

      {/* 非表示のインポート用input */}
      <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} aria-label="JSONファイルをインポート" />
    </>
  );
}

// ─── Settings Panel ───────────────────────────────────────
function SettingsPanel({ settings, onSave, onExport, onImport, logsCount }) {
  const [local, setLocal] = useState(settings);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <Card>
        <CardHeader icon="👤" title="Profile — プロフィール" />
        <div>
          <Lbl hint="BMI計算に使用">身長 (cm)</Lbl>
          <Inp
            type="number"
            placeholder="170"
            value={local.height}
            onChange={e => setLocal(p => ({ ...p, height: e.target.value }))}
            aria-label="身長"
          />
          {local.height && (
            <div style={{ fontSize: "0.65rem", marginTop: 4, color: C.muted }}>
              標準体重（BMI 22）: {+(22 * (parseFloat(local.height) / 100) ** 2).toFixed(1)}kg
            </div>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={handleSave} style={{
            width: "100%", padding: 12, borderRadius: 12, border: "none",
            background: saved ? "#22c55e" : `linear-gradient(135deg, ${C.green}, #a3e635)`,
            color: saved ? "#fff" : "#052e16",
            fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "0.85rem",
            cursor: "pointer", transition: "all 0.25s",
          }}>
            {saved ? "✅ 保存しました" : "💾 設定を保存"}
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader icon="💾" title="Data — データ管理" />
        <div style={{ fontSize: "0.75rem", color: C.muted, marginBottom: 14 }}>
          現在 <span style={{ color: C.green, fontWeight: 700 }}>{logsCount}件</span> の記録が保存されています
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={onExport} style={{
            width: "100%", padding: 12, borderRadius: 12,
            border: `1px solid ${C.green}40`, background: C.greenDim,
            color: C.green, fontFamily: "'Syne', sans-serif", fontWeight: 700,
            fontSize: "0.82rem", cursor: "pointer",
          }}>
            📤 JSONエクスポート
          </button>
          <button onClick={onImport} style={{
            width: "100%", padding: 12, borderRadius: 12,
            border: `1px solid rgba(255,255,255,0.1)`, background: "rgba(255,255,255,0.03)",
            color: C.mutedLight, fontFamily: "'Syne', sans-serif", fontWeight: 700,
            fontSize: "0.82rem", cursor: "pointer",
          }}>
            📥 JSONインポート（既存データとマージ）
          </button>
        </div>
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(251,191,36,0.06)", border: `1px solid rgba(251,191,36,0.2)`, fontSize: "0.72rem", color: C.yellow }}>
          ⚠️ データはブラウザのlocalStorageに保存されています。定期的なエクスポートをお勧めします。
        </div>
      </Card>
    </div>
  );
}

const MiniStat = ({ label, val, color = "#e2e8f0" }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: "0.6rem", color: "#475569", marginBottom: 1 }}>{label}</div>
    <div style={{ fontSize: "0.82rem", fontWeight: 600, color }}>{val}</div>
  </div>
);
