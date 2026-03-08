import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "healthlog_v3";
const SETTINGS_KEY = "healthlog_settings";
const todayStr = () => new Date().toISOString().split("T")[0];

// ─── defaultEntry ────────────────────────────────────────────
const defaultEntry = (date = todayStr()) => ({
  id: Date.now(), date,
  isHoliday: false,
  // Activity
  steps: "",
  sittingTime: "",       // 分
  sittingBreaks: "",     // 回
  mvpa: "",              // 分 (中〜高強度運動)
  // Sleep
  bedtime: "", wakeup: "",
  sleepSatisfaction: 5, // 0-10
  // Nutrition
  alcohol: "",           // ドリンク数
  urineColor: null,      // 1-8 (Armstrong scale)
  upfMeals: "",          // 超加工食品を含む食事回数/日
  breakfast: false,
  coffee: 0,
  // Vitals
  weight: "",
  socialInteraction: "", // 今日5分以上会話した回数
  lastMealTime: "",      // 最終食事時刻 HH:MM
  // Mental
  fatigue: 5,            // 0-10
  stress: 5,             // 0-10
  screenTime: "",        // 就寝前スクリーン時間(分)
  morningOutdoor: "",    // 朝屋外時間(分)
  // Body
  backPain: 5,           // 0-10 (腰痛・肩こり)
  // Work
  overtime: "",          // 分
  memo: "",
});

// ─── Score Config (20 items) ─────────────────────────────────
const SCORE_CONFIG = [
  { key: "steps",            label: "歩数",             coeff: 3, holidayExclude: false },
  { key: "sittingTime",      label: "座位時間",          coeff: 3, holidayExclude: true  },
  { key: "sittingBreaks",    label: "座位中断回数",       coeff: 2, holidayExclude: true  },
  { key: "mvpa",             label: "MVPA時間",          coeff: 3, holidayExclude: false },
  { key: "sleepDuration",    label: "睡眠時間",          coeff: 3, holidayExclude: false },
  { key: "bedtime",          label: "就寝時刻",          coeff: 3, holidayExclude: false },
  { key: "wakeupRegularity", label: "起床時刻規則性",    coeff: 3, holidayExclude: false },
  { key: "sleepSatisfaction",label: "睡眠満足度",        coeff: 3, holidayExclude: false },
  { key: "alcohol",          label: "アルコール",        coeff: 3, holidayExclude: false },
  { key: "weight",           label: "体重(目標差)",      coeff: 3, holidayExclude: false },
  { key: "socialInteraction", label: "社会的交流",        coeff: 3, holidayExclude: false },
  { key: "lastMealTime",      label: "最終食事時刻",      coeff: 3, holidayExclude: false },
  { key: "fatigue",          label: "疲労感",            coeff: 2, holidayExclude: false },
  { key: "stress",           label: "ストレス",          coeff: 2, holidayExclude: false },
  { key: "screenTime",       label: "就寝前スクリーン",  coeff: 2, holidayExclude: false },
  { key: "morningOutdoor",   label: "朝屋外時間",        coeff: 2, holidayExclude: false },
  { key: "backPain",         label: "腰痛・肩こり",      coeff: 2, holidayExclude: false },
  { key: "urineColor",       label: "尿の色(水分状態)",  coeff: 2, holidayExclude: false },
  { key: "upfMeals",         label: "超加工食品摂取",    coeff: 2, holidayExclude: false },
  { key: "overtime",         label: "残業時間",          coeff: 3, holidayExclude: true  },
];

const GRADE_THRESHOLDS = [
  { label: "S", min: 90, color: "#7c3aed" },
  { label: "A", min: 75, color: "#2563eb" },
  { label: "B", min: 60, color: "#16a34a" },
  { label: "C", min: 45, color: "#d97706" },
  { label: "D", min: 0,  color: "#dc2626" },
];

function getGrade(score) {
  return GRADE_THRESHOLDS.find(g => score >= g.min) || GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
}

// ─── utils ───────────────────────────────────────────────────
function calcSleep(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let m = (wh * 60 + wm) - (bh * 60 + bm);
  if (m < 0) m += 1440;
  return +(m / 60).toFixed(1);
}

function calcWakeupDeviation(entry, logs) {
  // 直近7日の起床時刻の平均との差分(分)
  const recent = logs
    .filter(l => l.date < entry.date && l.wakeup)
    .slice(0, 7)
    .map(l => {
      const [h, m] = l.wakeup.split(":").map(Number);
      return h * 60 + m;
    });
  if (recent.length < 2) return null;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (!entry.wakeup) return null;
  const [eh, em] = entry.wakeup.split(":").map(Number);
  const entryMin = eh * 60 + em;
  return Math.abs(entryMin - avg);
}

function calcStageForItem(key, entry, context) {
  const { targetWeight, wakeupDeviation } = context;

  switch (key) {
    case "steps": {
      const v = parseFloat(entry.steps);
      if (isNaN(v)) return null;
      if (v >= 7000) return 2;
      if (v >= 4000) return 1;
      return 0;
    }
    case "sittingTime": {
      const v = parseFloat(entry.sittingTime);
      if (isNaN(v)) return null;
      if (v < 480) return 2;
      if (v < 600) return 1;
      return 0;
    }
    case "sittingBreaks": {
      const v = parseFloat(entry.sittingBreaks);
      if (isNaN(v)) return null;
      if (v >= 10) return 2;
      if (v >= 5) return 1;
      return 0;
    }
    case "mvpa": {
      const v = parseFloat(entry.mvpa);
      if (isNaN(v)) return null;
      if (v >= 30) return 2;
      if (v >= 10) return 1;
      return 0;
    }
    case "sleepDuration": {
      const h = calcSleep(entry.bedtime, entry.wakeup);
      if (h === null) return null;
      if (h >= 7 && h <= 8) return 2;
      if ((h >= 6 && h < 7) || (h > 8 && h <= 9)) return 1;
      return 0;
    }
    case "bedtime": {
      if (!entry.bedtime) return null;
      const [hh, mm] = entry.bedtime.split(":").map(Number);
      const totalMin = hh * 60 + mm;
      // 22:00(1320)〜23:59(1439) → score 2
      // 00:01(1) 〜 00:59(59) → score 1  (翌0時台)
      // ≥01:00(60) → score 0
      // 0:00(0) = 深夜0時ちょうど → score 2
      if (totalMin === 0) return 2; // 0:00ちょうど
      if (totalMin >= 1320) return 2; // 22:00〜23:59
      if (totalMin <= 59) return 1;  // 0:01〜0:59
      return 0; // 1:00以降
    }
    case "wakeupRegularity": {
      if (wakeupDeviation === null) return null;
      if (wakeupDeviation <= 30) return 2;
      if (wakeupDeviation <= 60) return 1;
      return 0;
    }
    case "sleepSatisfaction": {
      const v = entry.sleepSatisfaction;
      if (v === null || v === undefined) return null;
      if (v >= 7) return 2;
      if (v >= 4) return 1;
      return 0;
    }
    case "alcohol": {
      const v = parseFloat(entry.alcohol);
      if (isNaN(v)) return null;
      if (v <= 1) return 2;
      if (v <= 3) return 1;
      return 0;
    }
    case "weight": {
      if (!targetWeight || !entry.weight) return null;
      const diff = Math.abs(parseFloat(entry.weight) - parseFloat(targetWeight));
      if (isNaN(diff)) return null;
      if (diff <= 1) return 2;
      if (diff <= 3) return 1;
      return 0;
    }
    case "socialInteraction": {
      if (entry.socialInteraction === "" || entry.socialInteraction === null || entry.socialInteraction === undefined) return null;
      const v = parseInt(entry.socialInteraction, 10);
      if (isNaN(v)) return null;
      if (v >= 2) return 2;
      if (v === 1) return 1;
      return 0;
    }
    case "lastMealTime": {
      if (!entry.lastMealTime) return null;
      const [hh, mm] = entry.lastMealTime.split(":").map(Number);
      const totalMin = hh * 60 + mm;
      // ≤19:00(1140) = ◎, 19:01〜20:59(1259) = △, ≥21:00(1260) = ✕
      if (totalMin <= 1140) return 2;
      if (totalMin <= 1259) return 1;
      return 0;
    }
    case "fatigue": {
      const v = entry.fatigue;
      if (v === null || v === undefined) return null;
      if (v <= 3) return 2;
      if (v <= 6) return 1;
      return 0;
    }
    case "stress": {
      const v = entry.stress;
      if (v === null || v === undefined) return null;
      if (v <= 4) return 2;
      if (v <= 7) return 1;
      return 0;
    }
    case "screenTime": {
      const v = parseFloat(entry.screenTime);
      if (isNaN(v)) return null;
      if (v < 30) return 2;
      if (v < 60) return 1;
      return 0;
    }
    case "morningOutdoor": {
      const v = parseFloat(entry.morningOutdoor);
      if (isNaN(v)) return null;
      if (v >= 15) return 2;
      if (v >= 1) return 1;
      return 0;
    }
    case "backPain": {
      const v = entry.backPain;
      if (v === null || v === undefined) return null;
      if (v <= 3) return 2;
      if (v <= 6) return 1;
      return 0;
    }
    case "urineColor": {
      const v = entry.urineColor;
      if (v === null || v === undefined) return null;
      // Armstrong scale: 1-3=良好(淡), 4-5=やや不足, 6-8=脱水
      if (v <= 3) return 2;
      if (v <= 5) return 1;
      return 0;
    }
    case "upfMeals": {
      if (entry.upfMeals === "" || entry.upfMeals === null || entry.upfMeals === undefined) return null;
      const v = parseInt(entry.upfMeals, 10);
      if (isNaN(v)) return null;
      if (v === 0) return 2;
      if (v === 1) return 1;
      return 0;
    }
    case "overtime": {
      const v = parseFloat(entry.overtime);
      if (isNaN(v)) return null;
      if (v < 60) return 2;
      if (v < 120) return 1;
      return 0;
    }
    default:
      return null;
  }
}

function calcHealthScore(entry, allLogs, settings) {
  const isHoliday = entry.isHoliday;
  const targetWeight = settings?.targetWeight;
  const wakeupDeviation = calcWakeupDeviation(entry, allLogs);
  const context = { targetWeight, wakeupDeviation };

  let sumWeighted = 0;
  let sumMax = 0;
  let recordedCount = 0;
  const details = [];

  for (const item of SCORE_CONFIG) {
    if (isHoliday && item.holidayExclude) continue;
    const stage = calcStageForItem(item.key, entry, context);
    const isRecorded = stage !== null;
    if (isRecorded) {
      sumWeighted += stage * item.coeff;
      sumMax += 2 * item.coeff;
      recordedCount++;
    }
    details.push({ ...item, stage, isRecorded });
  }

  if (recordedCount < 10) return { score: null, grade: null, recordedCount, details };

  const score = Math.round(sumWeighted / sumMax * 100);
  const grade = getGrade(score);
  return { score, grade, recordedCount, details };
}

function sevenDayAvg(logs, field) {
  const vals = logs.slice(0, 7).map(l => parseFloat(l[field])).filter(v => !isNaN(v));
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

function calcStreak(logs) {
  if (!logs.length) return 0;
  const sorted = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (const log of sorted) {
    const d = new Date(log.date + "T00:00:00");
    const diff = Math.round((cursor - d) / 86400000);
    if (diff <= 1) { streak++; cursor = d; }
    else break;
  }
  return streak;
}

function calcBMI(weight, height) {
  if (!weight || !height) return null;
  const h = parseFloat(height) / 100;
  return +(parseFloat(weight) / (h * h)).toFixed(1);
}

// ─── Sub Components ───────────────────────────────────────────

function NumericRating({ label, value, onChange, min = 0, max = 10, lowLabel = "低", highLabel = "高" }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: "#333" }}>{value !== null && value !== undefined ? value : "—"}</span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(v => (
          <button
            key={v}
            onClick={() => onChange(v)}
            style={{
              flex: 1,
              padding: "5px 0",
              fontSize: 11,
              border: "1px solid",
              borderRadius: 4,
              cursor: "pointer",
              background: value === v ? "#2563eb" : "#f3f4f6",
              color: value === v ? "#fff" : "#555",
              borderColor: value === v ? "#2563eb" : "#d1d5db",
              fontWeight: value === v ? 700 : 400,
            }}
          >
            {v}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

function ChipRow({ label, options, value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{label}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
            style={{
              padding: "5px 12px",
              border: "1px solid",
              borderRadius: 16,
              cursor: "pointer",
              fontSize: 13,
              background: value === opt.value ? "#2563eb" : "#f3f4f6",
              color: value === opt.value ? "#fff" : "#555",
              borderColor: value === opt.value ? "#2563eb" : "#d1d5db",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldRow({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

function NumberInput({ value, onChange, placeholder, unit, min, max, step = 1 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        style={{ ...inputStyle, flex: 1 }}
      />
      {unit && <span style={{ fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>{unit}</span>}
    </div>
  );
}

function Card({ title, children, accent }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 12,
      boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      borderLeft: accent ? `4px solid ${accent}` : undefined,
    }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 12, letterSpacing: "0.03em" }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function ScoreBadge({ score, grade, size = "md" }) {
  if (score === null) return (
    <div style={{ fontSize: size === "lg" ? 14 : 12, color: "#9ca3af" }}>
      スコア未算出<br /><span style={{ fontSize: 10 }}>(10項目以上記録で表示)</span>
    </div>
  );
  const big = size === "lg";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: big ? 48 : 28,
        fontWeight: 900,
        color: grade.color,
        lineHeight: 1,
      }}>
        {score}
      </div>
      <div style={{
        fontSize: big ? 22 : 14,
        fontWeight: 700,
        color: grade.color,
        marginTop: 2,
      }}>
        {grade.label}
      </div>
    </div>
  );
}

function ScoreDetailPanel({ details, isHoliday }) {
  const [open, setOpen] = useState(false);
  if (!details?.length) return null;
  const shown = details.filter(d => !isHoliday || !d.holidayExclude);
  const stageColor = (s) => s === 2 ? "#16a34a" : s === 1 ? "#d97706" : "#dc2626";
  const stageLabel = (s) => s === 2 ? "◎" : s === 1 ? "△" : "✕";

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 8 }}
      >
        {open ? "▲ スコア詳細を閉じる" : "▼ スコア詳細を見る"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {shown.map(d => (
            <div key={d.key} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "5px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12,
            }}>
              <span style={{ color: "#374151" }}>{d.label}</span>
              <span style={{
                fontWeight: 700, fontSize: 14,
                color: d.isRecorded ? stageColor(d.stage) : "#d1d5db",
              }}>
                {d.isRecorded ? stageLabel(d.stage) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CoffeeInfoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? "▲ コーヒーと健康の文献情報を閉じる" : "▼ コーヒーと健康の文献情報を見る"}
      </button>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#374151", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>コーヒーの健康への影響（文献ベース）</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: 4 }}>✓ 適量(1〜4杯/日)のメリット</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>2型糖尿病リスク低下（1杯増で6%減）[Ding et al., Diabetes Care 2014]</li>
              <li>心血管疾患死亡リスク低下（3〜5杯/日で最低）[Poole et al., BMJ 2017]</li>
              <li>神経変性疾患(パーキンソン・アルツハイマー)リスク低下 [Ross et al., JAMA 2000]</li>
              <li>肝疾患・肝硬変リスク低下 [Kennedy et al., Aliment Pharmacol Ther 2016]</li>
            </ul>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>✗ 過剰摂取・注意点</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>不安・不眠悪化（カフェイン半減期5〜6時間）</li>
              <li>骨密度低下・胃酸分泌増加（大量摂取時）</li>
              <li>妊婦・授乳中は200mg/日以下推奨 [EFSA 2015]</li>
              <li>非フィルタードコーヒーはLDL上昇の可能性 [Urgert & Katan, NEJM 1997]</li>
            </ul>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, color: "#374151", marginBottom: 4 }}>◯ 飲まない場合</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>カフェイン依存・離脱症状なし</li>
              <li>睡眠の質が改善する場合あり（特に午後摂取を避ける効果）</li>
              <li>胃食道逆流症(GERD)の改善</li>
            </ul>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
            ※ 1杯の定義：欧米研究では237mL(8oz)のレギュラーコーヒー(カフェイン約80-100mg)。日本のコンビニコーヒーSサイズは約120mL。
          </div>
        </div>
      )}
    </div>
  );
}

function SocialInfoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? "▲ 社会的交流と健康の文献情報を閉じる" : "▼ なぜ社会的交流が重要？文献情報を見る"}
      </button>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#374151", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>社会的つながりと健康・寿命</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>✗ 孤独・社会的孤立のリスク</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>全死亡リスク29%増加、孤独感は26%増加 [Holt-Lunstad et al., Perspectives on Psychological Science 2015 — 148研究・308,849人メタ分析]</li>
              <li>影響はタバコ15本/日、肥満・運動不足を上回ると試算</li>
              <li>認知症リスク増加 [Livingston et al., Lancet Commission 2020]</li>
              <li>うつ・不安症の主要リスク因子 [Cacioppo & Hawkley, 2010]</li>
              <li>炎症マーカー(CRP・IL-6)上昇との関連 [Steptoe et al., PNAS 2013]</li>
            </ul>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: 4 }}>✓ 交流がある場合のメリット</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>オキシトシン分泌→ストレスホルモン(コルチゾール)低下</li>
              <li>血圧・心拍数の安定化</li>
              <li>目的意識・幸福感の向上 [Steptoe & Wardle, PNAS 2014]</li>
            </ul>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
            ※ SNS・テキストのみは効果が弱い。音声/対面会話を優先してカウント
          </div>
        </div>
      )}
    </div>
  );
}

function LastMealInfoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? "▲ 最終食事時刻と健康の文献情報を閉じる" : "▼ なぜ食事時刻が重要？文献情報を見る"}
      </button>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#374151", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>時間制限食(TRE)と代謝・健康</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: 4 }}>✓ 早い時刻に食べ終わるメリット</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>インスリン感受性・血糖コントロール改善 [Sutton et al., Cell Metabolism 2018 — RCT]</li>
              <li>収縮期血圧低下・酸化ストレス軽減 [同上]</li>
              <li>代謝症候群の改善(体重・脂肪量・血圧・コレステロール) [Wilkinson et al., Cell Metabolism 2020 — 12週間RCT]</li>
              <li>睡眠の質改善（就寝時の消化負担軽減）</li>
              <li>概日リズム(体内時計)の安定化 [Longo & Panda, Cell Metabolism 2016]</li>
            </ul>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>✗ 夜遅い食事のリスク</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>21時以降の食事は肥満・メタボリックシンドロームと関連 [Wang et al., JCEM 2020]</li>
              <li>夜間の高血糖・インスリン分泌増加</li>
              <li>睡眠中の胃食道逆流(GERD)リスク増加</li>
            </ul>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
            ※ 目安: 就寝2〜3時間前までに食事を終える。間食・飲料(水・お茶を除く)もカウント
          </div>
        </div>
      )}
    </div>
  );
}

function UpfInfoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? "▲ 超加工食品と健康の文献情報を閉じる" : "▼ 超加工食品とは？文献情報を見る"}
      </button>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#374151", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>超加工食品（UPF）の健康への影響</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: "#374151", marginBottom: 4 }}>NOVA分類4とは</div>
            <p style={{ margin: 0, lineHeight: 1.8 }}>
              Monteiro et al.が提唱する食品加工度分類。UPFは工業的製造工程で作られ、食品添加物(乳化剤・甘味料・着色料等)を多く含む。
              代表例: スナック菓子、菓子パン、清涼飲料水、インスタント麺、加工肉、市販アイスクリーム。
            </p>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>✗ リスクとのエビデンス</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>全死亡・心血管疾患リスク上昇 [Srour et al., BMJ 2019; 10万人超のNutriNet-Santé]</li>
              <li>2型糖尿病リスク増加 [Levy et al., Diabetes Care 2021]</li>
              <li>大腸がんリスク増加 [Fiolet et al., BMJ 2018]</li>
              <li>うつ病・不安症との関連 [Lane et al., Nutritional Neuroscience 2022]</li>
              <li>腸内細菌叢の多様性低下 [UK Biobank; Wastyk et al., Cell 2021]</li>
              <li>RCTでも過剰カロリー摂取・体重増加を確認 [Hall et al., Cell Metabolism 2019]</li>
            </ul>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, color: "#374151", marginBottom: 4 }}>◯ 置き換えの目安</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>スナック→ナッツ・果物・ヨーグルト</li>
              <li>清涼飲料水→水・お茶・無糖コーヒー</li>
              <li>菓子パン→全粒粉パン・自炊</li>
            </ul>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
            ※ 記録方法: 1日のうち昼・夜・間食でUPFを食べた回数をカウント
          </div>
        </div>
      )}
    </div>
  );
}

function XPostPanel({ entry, score, grade }) {
  const [open, setOpen] = useState(false);
  const sleep = calcSleep(entry.bedtime, entry.wakeup);
  const lines = [
    `📅 ${entry.date} の健康記録`,
    score !== null ? `🏅 健康スコア: ${score}点 [${grade?.label}]` : null,
    entry.steps ? `👟 歩数: ${Number(entry.steps).toLocaleString()}歩` : null,
    sleep ? `😴 睡眠: ${sleep}h` : null,
    `#健康管理 #HealthTracker`,
  ].filter(Boolean).join("\n");
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(lines)}`;
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? "▲ X(Twitter)投稿文を閉じる" : "▼ X(Twitter)に投稿する"}
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: 10, background: "#f0f9ff", borderRadius: 8, fontSize: 12 }}>
          <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap", color: "#374151" }}>{lines}</pre>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block", marginTop: 8, padding: "6px 14px",
              background: "#000", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 12, fontWeight: 600,
            }}
          >
            X に投稿 →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [logs, setLogs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  });
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
  });
  const [entry, setEntry] = useState(() => {
    const today = todayStr();
    const existing = (JSON.parse(localStorage.getItem(STORAGE_KEY)) || []).find(l => l.date === today);
    return existing ? { ...defaultEntry(today), ...existing } : defaultEntry(today);
  });
  const [tab, setTab] = useState("today");
  const fileRef = useRef(null);

  const isPastEntry = entry.date !== todayStr();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const set = (field, val) => setEntry(e => ({ ...e, [field]: val }));

  function saveEntry() {
    setLogs(prev => {
      const idx = prev.findIndex(l => l.date === entry.date);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...entry, id: prev[idx].id };
        return next;
      }
      return [{ ...entry, id: Date.now() }, ...prev];
    });
    if (!isPastEntry) {
      alert("保存しました！");
    } else {
      alert(`${entry.date} のデータを更新しました`);
    }
  }

  function deleteLog(id) {
    if (!confirm("この記録を削除しますか？")) return;
    setLogs(prev => prev.filter(l => l.id !== id));
  }

  function loadDateEntry(date) {
    const existing = logs.find(l => l.date === date);
    setEntry(existing ? { ...defaultEntry(date), ...existing } : defaultEntry(date));
    setTab("today");
  }

  const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  const streak = calcStreak(logs);
  const bmi = calcBMI(entry.weight, settings.height);
  const sleepH = calcSleep(entry.bedtime, entry.wakeup);
  const { score, grade, recordedCount, details } = calcHealthScore(entry, sortedLogs, settings);

  // ─── Today Tab ──────────────────────────────────────────────
  const TodayTab = () => (
    <div style={{ paddingBottom: 80 }}>
      {/* Header Score */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              {isPastEntry ? `📅 ${entry.date}（過去）` : `📅 ${entry.date} (今日)`}
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>記録済み {recordedCount}/20項目</div>
            {streak > 1 && (
              <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 2 }}>🔥 {streak}日連続記録中</div>
            )}
          </div>
          <ScoreBadge score={score} grade={grade} size="lg" />
        </div>
        <ScoreDetailPanel details={details} isHoliday={entry.isHoliday} />
        {score !== null && <XPostPanel entry={entry} score={score} grade={grade} />}
      </Card>

      {isPastEntry && (
        <div style={{
          background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px",
          marginBottom: 12, fontSize: 13, color: "#92400e",
        }}>
          ⚠️ 過去のデータを編集中です。保存で上書きされます。
        </div>
      )}

      {/* Holiday Toggle */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, color: "#374151" }}>休日モード</span>
          <button
            onClick={() => set("isHoliday", !entry.isHoliday)}
            style={{
              padding: "5px 14px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: entry.isHoliday ? "#7c3aed" : "#e5e7eb",
              color: entry.isHoliday ? "#fff" : "#374151",
            }}
          >
            {entry.isHoliday ? "ON (休日)" : "OFF (平日)"}
          </button>
        </div>
        {entry.isHoliday && (
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            休日時は「座位時間・座位中断・残業」をスコア除外
          </div>
        )}
      </Card>

      {/* Activity */}
      <Card title="🏃 活動" accent="#2563eb">
        <FieldRow label="歩数" hint="目安: 7000歩以上 ◎">
          <NumberInput value={entry.steps} onChange={v => set("steps", v)} placeholder="例: 8500" unit="歩" min={0} />
        </FieldRow>
        <FieldRow label="MVPA時間（中〜高強度運動）" hint="目安: 30分以上 ◎ | ウォーキング速歩・ジョギング・水泳など">
          <NumberInput value={entry.mvpa} onChange={v => set("mvpa", v)} placeholder="例: 30" unit="分" min={0} />
        </FieldRow>
        {!entry.isHoliday && <>
          <FieldRow label="座位時間" hint="目安: 480分(8h)未満 ◎">
            <NumberInput value={entry.sittingTime} onChange={v => set("sittingTime", v)} placeholder="例: 420" unit="分" min={0} />
          </FieldRow>
          <FieldRow label="座位中断回数" hint="目安: 10回以上 ◎ | 1時間ごとに立ち上がる">
            <NumberInput value={entry.sittingBreaks} onChange={v => set("sittingBreaks", v)} placeholder="例: 10" unit="回" min={0} />
          </FieldRow>
        </>}
      </Card>

      {/* Sleep */}
      <Card title="😴 睡眠" accent="#7c3aed">
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <FieldRow label="就寝時刻">
            <input type="time" value={entry.bedtime} onChange={e => set("bedtime", e.target.value)} style={inputStyle} />
          </FieldRow>
          <FieldRow label="起床時刻">
            <input type="time" value={entry.wakeup} onChange={e => set("wakeup", e.target.value)} style={inputStyle} />
          </FieldRow>
        </div>
        {sleepH !== null && (
          <div style={{ fontSize: 13, color: "#374151", marginBottom: 10, padding: "6px 10px", background: "#f0f9ff", borderRadius: 6 }}>
            睡眠時間: <strong>{sleepH}時間</strong>
            {sleepH >= 7 && sleepH <= 8
              ? " ✓ 最適"
              : sleepH >= 6 ? " △ やや短い/長い" : " ✕ 要改善"}
          </div>
        )}
        <FieldRow label="就寝前スクリーン時間" hint="目安: 30分未満 ◎">
          <NumberInput value={entry.screenTime} onChange={v => set("screenTime", v)} placeholder="例: 20" unit="分" min={0} />
        </FieldRow>
        <NumericRating
          label="睡眠の満足度 (0〜10)"
          value={entry.sleepSatisfaction}
          onChange={v => set("sleepSatisfaction", v)}
          lowLabel="不満"
          highLabel="満足"
        />
      </Card>

      {/* Nutrition */}
      <Card title="🥗 栄養・食事" accent="#16a34a">
        <FieldRow
          label="尿の色（水分補給状態）"
          hint="Armstrong尺度: 1-3=良好 ◎ / 4-5=やや不足 △ / 6-8=脱水 ✕"
        >
          <div style={{ display: "flex", gap: 3 }}>
            {[
              { v: 1, label: "1", bg: "#fef9c3" },
              { v: 2, label: "2", bg: "#fef08a" },
              { v: 3, label: "3", bg: "#fde047" },
              { v: 4, label: "4", bg: "#facc15" },
              { v: 5, label: "5", bg: "#eab308" },
              { v: 6, label: "6", bg: "#ca8a04" },
              { v: 7, label: "7", bg: "#92400e" },
              { v: 8, label: "8", bg: "#422006" },
            ].map(({ v, label, bg }) => (
              <button
                key={v}
                onClick={() => set("urineColor", entry.urineColor === v ? null : v)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  fontSize: 12,
                  border: "2px solid",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: bg,
                  color: v >= 6 ? "#fff" : "#374151",
                  borderColor: entry.urineColor === v ? "#2563eb" : "transparent",
                  fontWeight: entry.urineColor === v ? 700 : 400,
                  outline: entry.urineColor === v ? "2px solid #2563eb" : "none",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af", marginTop: 3 }}>
            <span>◎ 良好(淡)</span>
            <span>△ やや不足</span>
            <span>✕ 脱水(濃)</span>
          </div>
        </FieldRow>
        <FieldRow
          label="超加工食品（UPF）を含む食事回数"
          hint="菓子パン・スナック・インスタント麺・清涼飲料水など NOVA分類4 | 目安: 0回 ◎"
        >
          <ChipRow
            options={[
              { label: "0回 ◎", value: "0" },
              { label: "1回 △", value: "1" },
              { label: "2回", value: "2" },
              { label: "3回以上", value: "3" },
            ]}
            value={entry.upfMeals !== "" ? String(entry.upfMeals) : ""}
            onChange={v => set("upfMeals", v === entry.upfMeals ? "" : v)}
          />
          <UpfInfoPanel />
        </FieldRow>
        <FieldRow label="アルコール" hint="1ドリンク=純アルコール14g | 目安: 1ドリンク以下 ◎">
          <NumberInput value={entry.alcohol} onChange={v => set("alcohol", v)} placeholder="例: 1" unit="ドリンク" min={0} step={0.5} />
        </FieldRow>
        <FieldRow label="朝食">
          <ChipRow
            options={[{ label: "食べた ✓", value: true }, { label: "食べなかった", value: false }]}
            value={entry.breakfast}
            onChange={v => set("breakfast", v)}
          />
        </FieldRow>
        <FieldRow label={`コーヒー (${entry.coffee}杯)`}>
          <input
            type="range"
            min={0}
            max={8}
            value={entry.coffee}
            onChange={e => set("coffee", Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af" }}>
            <span>0杯</span><span>4杯</span><span>8杯</span>
          </div>
          <CoffeeInfoPanel />
        </FieldRow>
      </Card>

      {/* Vitals */}
      <Card title="💊 体重・交流・食事時間" accent="#dc2626">
        <FieldRow label="体重" hint={settings.targetWeight ? `目標体重: ${settings.targetWeight}kg` : "設定タブで目標体重を設定"}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NumberInput value={entry.weight} onChange={v => set("weight", v)} placeholder="例: 65.0" unit="kg" min={30} max={200} step={0.1} />
            {bmi && <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>BMI: {bmi}</span>}
          </div>
        </FieldRow>
        <FieldRow
          label="社会的交流（5分以上の会話）"
          hint="家族・友人・同僚とのリアル/電話会話 | 目安: 2回以上 ◎"
        >
          <ChipRow
            options={[
              { label: "0回", value: "0" },
              { label: "1回", value: "1" },
              { label: "2回 ◎", value: "2" },
              { label: "3回以上 ◎", value: "3" },
            ]}
            value={entry.socialInteraction !== "" ? String(entry.socialInteraction) : ""}
            onChange={v => set("socialInteraction", v === entry.socialInteraction ? "" : v)}
          />
          <SocialInfoPanel />
        </FieldRow>
        <FieldRow
          label="最終食事・間食の時刻"
          hint="目安: 19:00以前 ◎ / 19:01〜20:59 △ / 21:00以降 ✕"
        >
          <input
            type="time"
            value={entry.lastMealTime}
            onChange={e => set("lastMealTime", e.target.value)}
            style={inputStyle}
          />
          <LastMealInfoPanel />
        </FieldRow>
      </Card>

      {/* Mental */}
      <Card title="🧠 メンタル・主観" accent="#f59e0b">
        <NumericRating
          label="疲労感 (0〜10)"
          value={entry.fatigue}
          onChange={v => set("fatigue", v)}
          lowLabel="元気"
          highLabel="疲弊"
        />
        <NumericRating
          label="ストレス (0〜10)"
          value={entry.stress}
          onChange={v => set("stress", v)}
          lowLabel="なし"
          highLabel="強い"
        />
        <NumericRating
          label="腰痛・肩こり (0〜10)"
          value={entry.backPain}
          onChange={v => set("backPain", v)}
          lowLabel="なし"
          highLabel="強い"
        />
        <FieldRow label="朝の屋外時間" hint="目安: 15分以上 ◎ | 朝日光でサーカディアンリズム調整">
          <NumberInput value={entry.morningOutdoor} onChange={v => set("morningOutdoor", v)} placeholder="例: 15" unit="分" min={0} />
        </FieldRow>
      </Card>

      {/* Work */}
      {!entry.isHoliday && (
        <Card title="💼 仕事" accent="#6b7280">
          <FieldRow label="残業時間" hint="目安: 60分未満 ◎">
            <NumberInput value={entry.overtime} onChange={v => set("overtime", v)} placeholder="例: 30" unit="分" min={0} />
          </FieldRow>
        </Card>
      )}

      {/* Memo */}
      <Card title="📝 メモ">
        <textarea
          value={entry.memo}
          onChange={e => set("memo", e.target.value)}
          placeholder="今日の気づき・体調メモ…"
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Card>

      {/* Date Jump */}
      <Card>
        <FieldRow label="別の日付を開く">
          <input
            type="date"
            value={entry.date}
            max={todayStr()}
            onChange={e => loadDateEntry(e.target.value)}
            style={inputStyle}
          />
        </FieldRow>
      </Card>

      {/* Save Button */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px", background: "#fff", boxShadow: "0 -1px 8px rgba(0,0,0,0.1)", zIndex: 100 }}>
        <button
          onClick={saveEntry}
          style={{
            width: "100%", padding: "13px", background: "#2563eb", color: "#fff",
            border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: "pointer",
          }}
        >
          {isPastEntry ? "過去データを更新" : "今日の記録を保存"}
        </button>
      </div>
    </div>
  );

  // ─── History Tab ────────────────────────────────────────────
  const HistoryTab = () => {
    const [filter, setFilter] = useState("all");
    const filtered = filter === "all" ? sortedLogs : sortedLogs.filter(l => l.isHoliday === (filter === "holiday"));
    return (
      <div style={{ paddingBottom: 20 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[["all", "全て"], ["weekday", "平日"], ["holiday", "休日"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{
              padding: "5px 12px", borderRadius: 16, border: "1px solid",
              background: filter === v ? "#2563eb" : "#f3f4f6",
              color: filter === v ? "#fff" : "#555",
              borderColor: filter === v ? "#2563eb" : "#d1d5db",
              fontSize: 13, cursor: "pointer",
            }}>{l}</button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", marginTop: 40 }}>記録がありません</div>
        )}
        {filtered.map(log => {
          const { score, grade } = calcHealthScore(log, sortedLogs.filter(l => l.date < log.date), settings);
          const sh = calcSleep(log.bedtime, log.wakeup);
          return (
            <div key={log.id} style={{
              background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8,
              boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
              borderLeft: grade ? `4px solid ${grade.color}` : "4px solid #e5e7eb",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {log.date} {log.isHoliday ? "🏖" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    {log.steps ? `👟 ${Number(log.steps).toLocaleString()}歩` : ""}
                    {sh ? ` 😴 ${sh}h` : ""}
                    {log.weight ? ` ⚖️ ${log.weight}kg` : ""}
                  </div>
                  {log.memo && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{log.memo.slice(0, 40)}{log.memo.length > 40 ? "…" : ""}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <ScoreBadge score={score} grade={grade} size="sm" />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => loadDateEntry(log.date)} style={{
                      fontSize: 12, padding: "3px 8px", border: "1px solid #d1d5db",
                      borderRadius: 6, background: "#f3f4f6", cursor: "pointer", color: "#374151",
                    }}>編集</button>
                    <button onClick={() => deleteLog(log.id)} style={{
                      fontSize: 12, padding: "3px 8px", border: "1px solid #fca5a5",
                      borderRadius: 6, background: "#fff1f2", cursor: "pointer", color: "#dc2626",
                    }}>削除</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Insight Tab ────────────────────────────────────────────
  const InsightTab = () => {
    const recent = sortedLogs.slice(0, 14);
    const avg7steps = sevenDayAvg(sortedLogs, "steps");
    const avg7sleep = sevenDayAvg(
      sortedLogs.map(l => ({ ...l, sleepH: calcSleep(l.bedtime, l.wakeup) })),
      "sleepH"
    );
    const avg7weight = sevenDayAvg(sortedLogs, "weight");

    const scoredLogs = recent.map(l => {
      const { score, grade } = calcHealthScore(l, sortedLogs.filter(x => x.date < l.date), settings);
      return { ...l, score, grade };
    }).filter(l => l.score !== null).reverse();

    const maxScore = Math.max(...scoredLogs.map(l => l.score), 100);

    return (
      <div>
        {/* Score Trend */}
        {scoredLogs.length > 0 && (
          <Card title="📈 健康スコア推移（直近）">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
              {scoredLogs.map(l => (
                <div key={l.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ fontSize: 9, color: l.grade?.color, fontWeight: 700 }}>{l.score}</div>
                  <div style={{
                    width: "100%",
                    height: `${(l.score / maxScore) * 64}px`,
                    background: l.grade?.color || "#9ca3af",
                    borderRadius: "3px 3px 0 0",
                    minHeight: 4,
                  }} />
                  <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 2 }}>{l.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Stats */}
        <Card title="📊 直近7日間の平均">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "歩数", val: avg7steps ? `${avg7steps.toLocaleString()}歩` : "—" },
              { label: "睡眠", val: avg7sleep ? `${avg7sleep}h` : "—" },
              { label: "体重", val: avg7weight ? `${avg7weight}kg` : "—" },
            ].map(({ label, val }) => (
              <div key={label} style={{ textAlign: "center", padding: 10, background: "#f9fafb", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
                <div style={{ fontWeight: 700, color: "#374151", marginTop: 4 }}>{val}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Score Grade Distribution */}
        {scoredLogs.length > 0 && (
          <Card title="🏅 グレード分布">
            {GRADE_THRESHOLDS.map(g => {
              const count = scoredLogs.filter(l => l.grade?.label === g.label).length;
              return (
                <div key={g.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 24, fontWeight: 700, color: g.color, fontSize: 14 }}>{g.label}</div>
                  <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 4, height: 16, overflow: "hidden" }}>
                    {count > 0 && (
                      <div style={{
                        width: `${(count / scoredLogs.length) * 100}%`,
                        height: "100%",
                        background: g.color,
                        borderRadius: 4,
                      }} />
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", width: 30, textAlign: "right" }}>{count}日</div>
                </div>
              );
            })}
          </Card>
        )}

        {/* Streak */}
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, fontWeight: 900 }}>🔥 {streak}</div>
            <div style={{ color: "#6b7280", fontSize: 14 }}>日連続記録</div>
          </div>
        </Card>
      </div>
    );
  };

  // ─── Settings Tab ────────────────────────────────────────────
  const SettingsTab = () => {
    const [localSettings, setLocalSettings] = useState(settings);
    const setSetting = (k, v) => setLocalSettings(s => ({ ...s, [k]: v }));

    function exportData() {
      const blob = new Blob([JSON.stringify({ logs, settings }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `healthlog_${todayStr()}.json`;
      a.click(); URL.revokeObjectURL(url);
    }

    function importData(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.logs) setLogs(data.logs);
          if (data.settings) setSettings(data.settings);
          alert("インポートしました");
        } catch { alert("ファイル形式が正しくありません"); }
      };
      reader.readAsText(file);
    }

    return (
      <div>
        <Card title="⚙️ 個人設定">
          <FieldRow label="身長 (cm)">
            <NumberInput value={localSettings.height || ""} onChange={v => setSetting("height", v)} placeholder="例: 170" unit="cm" />
          </FieldRow>
          <FieldRow label="目標体重 (kg)" hint="体重スコア計算に使用">
            <NumberInput value={localSettings.targetWeight || ""} onChange={v => setSetting("targetWeight", v)} placeholder="例: 65.0" unit="kg" step={0.1} />
          </FieldRow>
          <button
            onClick={() => { setSettings(localSettings); alert("保存しました"); }}
            style={{
              width: "100%", padding: 10, background: "#2563eb", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            設定を保存
          </button>
        </Card>

        <Card title="📁 データ管理">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={exportData}
              style={{ padding: 10, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              JSONエクスポート
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              style={{ padding: 10, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              JSONインポート
            </button>
            <input type="file" accept=".json" ref={fileRef} onChange={importData} style={{ display: "none" }} />
            <button
              onClick={() => {
                if (confirm("全データを削除しますか？この操作は元に戻せません。")) {
                  setLogs([]);
                  alert("削除しました");
                }
              }}
              style={{ padding: 10, background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              全データ削除
            </button>
          </div>
        </Card>

        <Card title="📖 スコア説明">
          <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.8 }}>
            <div style={{ marginBottom: 8 }}>
              健康スコアは<strong>20項目</strong>の記録を元に算出します。<br />
              各項目は0〜2段階で評価され、係数(★★★=3, ★★☆=2)で重み付けされます。
            </div>
            <div style={{ marginBottom: 6 }}>スコア = Σ(段階×係数) ÷ Σ(最大段階×係数) × 100</div>
            <div style={{ marginBottom: 4 }}>
              {GRADE_THRESHOLDS.map(g => (
                <span key={g.label} style={{ marginRight: 10 }}>
                  <strong style={{ color: g.color }}>{g.label}</strong>: {g.min}点以上
                </span>
              ))}
            </div>
            <div style={{ color: "#9ca3af", fontSize: 11 }}>※ 10項目以上記録で表示 | 休日は座位・残業除外</div>
          </div>
        </Card>
      </div>
    );
  };

  // ─── Tab Bar ─────────────────────────────────────────────────
  const tabs = [
    { id: "today", label: "記録" },
    { id: "history", label: "履歴" },
    { id: "insight", label: "分析" },
    { id: "settings", label: "設定" },
  ];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f9fafb", minHeight: "100vh" }}>
      {/* Top Bar */}
      <div style={{ background: "#fff", padding: "14px 16px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#1f2937" }}>🌿 HealthLog</div>
        <div style={{ display: "flex", gap: 0, marginTop: 8, borderBottom: "1px solid #e5e7eb" }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "7px 0", background: "none", border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? "#2563eb" : "#6b7280",
                borderBottom: tab === t.id ? "2px solid #2563eb" : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "12px 12px 0" }}>
        {tab === "today" && <TodayTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "insight" && <InsightTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
