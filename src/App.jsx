import { useState, useEffect, useRef } from "react";
import { fetchLogs, fetchSettings, upsertLog, deleteLog as deleteLogDB, saveSettings as saveSettingsDB } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
      if (totalMin === 0) return 2;
      if (totalMin >= 1320) return 2;
      if (totalMin <= 59) return 1;
      return 0;
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
    <div className="mb-3.5">
      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
        <span>{label}</span>
        <span className="font-semibold text-gray-700">{value !== null && value !== undefined ? value : "—"}</span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(v => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              "flex-1 min-h-[36px] text-[11px] border rounded cursor-pointer transition-all duration-150 active:scale-95",
              value === v
                ? "bg-blue-600 text-white border-blue-600 font-bold"
                : "bg-gray-100 text-gray-500 border-gray-200"
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

function ChipRow({ label, options, value, onChange }) {
  return (
    <div className="mb-3.5">
      {label && <div className="text-xs text-gray-500 mb-1.5">{label}</div>}
      <div className="flex gap-1.5 flex-wrap">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
            className={cn(
              "px-3 py-2 min-h-[36px] border rounded-full cursor-pointer text-sm transition-all duration-150 active:scale-95",
              value === opt.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-gray-100 text-gray-500 border-gray-200"
            )}
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
    <div className="mb-4">
      <div className="text-xs font-medium text-gray-500 mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

function NumberInput({ value, onChange, placeholder, unit, min, max, step = 1 }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className="flex-1 h-10 text-sm"
      />
      {unit && <span className="text-sm text-gray-500 whitespace-nowrap">{unit}</span>}
    </div>
  );
}

function ImeTextarea({ value, onChange, ...props }) {
  const [local, setLocal] = useState(value);
  const composing = useRef(false);
  useEffect(() => { if (!composing.current) setLocal(value); }, [value]);
  return (
    <textarea
      {...props}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={e => { composing.current = false; onChange(e.target.value); }}
      onBlur={e => { if (!composing.current) onChange(e.target.value); }}
    />
  );
}

function AppCard({ title, children, accent }) {
  return (
    <div
      className="bg-white rounded-2xl px-4 py-4 mb-4 shadow-sm"
      style={accent ? { borderLeft: `4px solid ${accent}` } : undefined}
    >
      {title && (
        <div className="text-sm font-bold text-gray-700 mb-3">{title}</div>
      )}
      {children}
    </div>
  );
}

function ScoreBadge({ score, grade, size = "md" }) {
  if (score === null) return (
    <div className={cn("text-gray-400", size === "lg" ? "text-sm" : "text-xs")}>
      スコア未算出<br /><span className="text-[10px]">(10項目以上記録で表示)</span>
    </div>
  );
  const big = size === "lg";
  return (
    <div className={cn("text-center", big ? "w-32" : "")}>
      <div
        className={cn("font-black leading-none tabular-nums", big ? "text-6xl" : "text-[28px]")}
        style={{ color: grade.color }}
      >
        {score}
      </div>
      <div
        className={cn("font-bold mt-0.5 tracking-tight", big ? "text-2xl" : "text-sm")}
        style={{ color: grade.color }}
      >
        {grade.label}
      </div>
      {big && (
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-2">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${score}%`, background: grade.color }}
          />
        </div>
      )}
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
        className="text-xs text-blue-600 bg-transparent border-none cursor-pointer p-0 mt-2"
      >
        {open ? "▲ スコア詳細を閉じる" : "▼ スコア詳細を見る"}
      </button>
      {open && (
        <div className="mt-2">
          {shown.map(d => (
            <div key={d.key} className="flex items-center justify-between py-1 border-b border-gray-100 text-xs">
              <span className="text-gray-700">{d.label}</span>
              <span
                className="font-bold text-sm"
                style={{ color: d.isRecorded ? stageColor(d.stage) : "#d1d5db" }}
              >
                {d.isRecorded ? stageLabel(d.stage) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoPanel({ toggleLabel, closeLabel, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-blue-600 bg-transparent border-none cursor-pointer p-0"
      >
        {open ? closeLabel : toggleLabel}
      </button>
      {open && (
        <div className="mt-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

function CoffeeInfoPanel() {
  return (
    <InfoPanel
      toggleLabel="▼ コーヒーと健康の文献情報を見る"
      closeLabel="▲ コーヒーと健康の文献情報を閉じる"
    >
      <div className="font-bold mb-2">コーヒーの健康への影響（文献ベース）</div>
      <div className="mb-2.5">
        <div className="font-semibold text-green-700 mb-1">✓ 適量(1〜4杯/日)のメリット</div>
        <ul className="m-0 pl-4 leading-7">
          <li>2型糖尿病リスク低下（1杯増で6%減）[Ding et al., Diabetes Care 2014]</li>
          <li>心血管疾患死亡リスク低下（3〜5杯/日で最低）[Poole et al., BMJ 2017]</li>
          <li>神経変性疾患(パーキンソン・アルツハイマー)リスク低下 [Ross et al., JAMA 2000]</li>
          <li>肝疾患・肝硬変リスク低下 [Kennedy et al., Aliment Pharmacol Ther 2016]</li>
        </ul>
      </div>
      <div className="mb-2.5">
        <div className="font-semibold text-red-600 mb-1">✗ 過剰摂取・注意点</div>
        <ul className="m-0 pl-4 leading-7">
          <li>不安・不眠悪化（カフェイン半減期5〜6時間）</li>
          <li>骨密度低下・胃酸分泌増加（大量摂取時）</li>
          <li>妊婦・授乳中は200mg/日以下推奨 [EFSA 2015]</li>
          <li>非フィルタードコーヒーはLDL上昇の可能性 [Urgert & Katan, NEJM 1997]</li>
        </ul>
      </div>
      <div className="mb-1">
        <div className="font-semibold text-gray-700 mb-1">◯ 飲まない場合</div>
        <ul className="m-0 pl-4 leading-7">
          <li>カフェイン依存・離脱症状なし</li>
          <li>睡眠の質が改善する場合あり（特に午後摂取を避ける効果）</li>
          <li>胃食道逆流症(GERD)の改善</li>
        </ul>
      </div>
      <div className="mt-2 text-[11px] text-gray-400">
        ※ 1杯の定義：欧米研究では237mL(8oz)のレギュラーコーヒー(カフェイン約80-100mg)。日本のコンビニコーヒーSサイズは約120mL。
      </div>
    </InfoPanel>
  );
}

function SocialInfoPanel() {
  return (
    <InfoPanel
      toggleLabel="▼ なぜ社会的交流が重要？文献情報を見る"
      closeLabel="▲ 社会的交流と健康の文献情報を閉じる"
    >
      <div className="font-bold mb-2">社会的つながりと健康・寿命</div>
      <div className="mb-2">
        <div className="font-semibold text-red-600 mb-1">✗ 孤独・社会的孤立のリスク</div>
        <ul className="m-0 pl-4 leading-7">
          <li>全死亡リスク29%増加、孤独感は26%増加 [Holt-Lunstad et al., Perspectives on Psychological Science 2015 — 148研究・308,849人メタ分析]</li>
          <li>影響はタバコ15本/日、肥満・運動不足を上回ると試算</li>
          <li>認知症リスク増加 [Livingston et al., Lancet Commission 2020]</li>
          <li>うつ・不安症の主要リスク因子 [Cacioppo & Hawkley, 2010]</li>
          <li>炎症マーカー(CRP・IL-6)上昇との関連 [Steptoe et al., PNAS 2013]</li>
        </ul>
      </div>
      <div className="mb-1">
        <div className="font-semibold text-green-700 mb-1">✓ 交流がある場合のメリット</div>
        <ul className="m-0 pl-4 leading-7">
          <li>オキシトシン分泌→ストレスホルモン(コルチゾール)低下</li>
          <li>血圧・心拍数の安定化</li>
          <li>目的意識・幸福感の向上 [Steptoe & Wardle, PNAS 2014]</li>
        </ul>
      </div>
      <div className="mt-1.5 text-[11px] text-gray-400">
        ※ SNS・テキストのみは効果が弱い。音声/対面会話を優先してカウント
      </div>
    </InfoPanel>
  );
}

function LastMealInfoPanel() {
  return (
    <InfoPanel
      toggleLabel="▼ なぜ食事時刻が重要？文献情報を見る"
      closeLabel="▲ 最終食事時刻と健康の文献情報を閉じる"
    >
      <div className="font-bold mb-2">時間制限食(TRE)と代謝・健康</div>
      <div className="mb-2">
        <div className="font-semibold text-green-700 mb-1">✓ 早い時刻に食べ終わるメリット</div>
        <ul className="m-0 pl-4 leading-7">
          <li>インスリン感受性・血糖コントロール改善 [Sutton et al., Cell Metabolism 2018 — RCT]</li>
          <li>収縮期血圧低下・酸化ストレス軽減 [同上]</li>
          <li>代謝症候群の改善(体重・脂肪量・血圧・コレステロール) [Wilkinson et al., Cell Metabolism 2020 — 12週間RCT]</li>
          <li>睡眠の質改善（就寝時の消化負担軽減）</li>
          <li>概日リズム(体内時計)の安定化 [Longo & Panda, Cell Metabolism 2016]</li>
        </ul>
      </div>
      <div className="mb-1">
        <div className="font-semibold text-red-600 mb-1">✗ 夜遅い食事のリスク</div>
        <ul className="m-0 pl-4 leading-7">
          <li>21時以降の食事は肥満・メタボリックシンドロームと関連 [Wang et al., JCEM 2020]</li>
          <li>夜間の高血糖・インスリン分泌増加</li>
          <li>睡眠中の胃食道逆流(GERD)リスク増加</li>
        </ul>
      </div>
      <div className="mt-1.5 text-[11px] text-gray-400">
        ※ 目安: 就寝2〜3時間前までに食事を終える。間食・飲料(水・お茶を除く)もカウント
      </div>
    </InfoPanel>
  );
}

function UpfInfoPanel() {
  return (
    <InfoPanel
      toggleLabel="▼ 超加工食品とは？文献情報を見る"
      closeLabel="▲ 超加工食品と健康の文献情報を閉じる"
    >
      <div className="font-bold mb-2">超加工食品（UPF）の健康への影響</div>
      <div className="mb-2">
        <div className="font-semibold text-gray-700 mb-1">NOVA分類4とは</div>
        <p className="m-0 leading-7">
          Monteiro et al.が提唱する食品加工度分類。UPFは工業的製造工程で作られ、食品添加物(乳化剤・甘味料・着色料等)を多く含む。
          代表例: スナック菓子、菓子パン、清涼飲料水、インスタント麺、加工肉、市販アイスクリーム。
        </p>
      </div>
      <div className="mb-2">
        <div className="font-semibold text-red-600 mb-1">✗ リスクとのエビデンス</div>
        <ul className="m-0 pl-4 leading-7">
          <li>全死亡・心血管疾患リスク上昇 [Srour et al., BMJ 2019; 10万人超のNutriNet-Santé]</li>
          <li>2型糖尿病リスク増加 [Levy et al., Diabetes Care 2021]</li>
          <li>大腸がんリスク増加 [Fiolet et al., BMJ 2018]</li>
          <li>うつ病・不安症との関連 [Lane et al., Nutritional Neuroscience 2022]</li>
          <li>腸内細菌叢の多様性低下 [UK Biobank; Wastyk et al., Cell 2021]</li>
          <li>RCTでも過剰カロリー摂取・体重増加を確認 [Hall et al., Cell Metabolism 2019]</li>
        </ul>
      </div>
      <div className="mb-1">
        <div className="font-semibold text-gray-700 mb-1">◯ 置き換えの目安</div>
        <ul className="m-0 pl-4 leading-7">
          <li>スナック→ナッツ・果物・ヨーグルト</li>
          <li>清涼飲料水→水・お茶・無糖コーヒー</li>
          <li>菓子パン→全粒粉パン・自炊</li>
        </ul>
      </div>
      <div className="mt-1.5 text-[11px] text-gray-400">
        ※ 記録方法: 1日のうち昼・夜・間食でUPFを食べた回数をカウント
      </div>
    </InfoPanel>
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
    <div className="mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-blue-600 bg-transparent border-none cursor-pointer p-0"
      >
        {open ? "▲ X(Twitter)投稿文を閉じる" : "▼ X(Twitter)に投稿する"}
      </button>
      {open && (
        <div className="mt-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-gray-700">
          <pre className="m-0 font-[inherit] whitespace-pre-wrap text-gray-700">{lines}</pre>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 px-3.5 py-1.5 bg-black text-white rounded-lg no-underline text-xs font-semibold"
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
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({});
  const [entry, setEntry] = useState(() => defaultEntry(todayStr()));
  const [tab, setTab] = useState("today");
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);

  const isPastEntry = entry.date !== todayStr();

  // Supabase から初期データ取得
  useEffect(() => {
    async function loadData() {
      try {
        const [fetchedLogs, fetchedSettings] = await Promise.all([fetchLogs(), fetchSettings()]);
        setLogs(fetchedLogs);
        setSettings(fetchedSettings);
        const today = todayStr();
        const existing = fetchedLogs.find(l => l.date === today);
        setEntry(existing ? { ...defaultEntry(today), ...existing } : defaultEntry(today));
      } catch (e) {
        console.error("データ取得エラー:", e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const set = (field, val) => setEntry(e => ({ ...e, [field]: val }));

  async function saveEntry() {
    try {
      await upsertLog(entry);
      setLogs(prev => {
        const idx = prev.findIndex(l => l.date === entry.date);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...entry };
          return next;
        }
        return [{ ...entry }, ...prev];
      });
      if (!isPastEntry) {
        alert("保存しました！");
      } else {
        alert(`${entry.date} のデータを更新しました`);
      }
    } catch (e) {
      alert("保存に失敗しました: " + e.message);
    }
  }

  async function deleteLog(date) {
    if (!confirm("この記録を削除しますか？")) return;
    try {
      await deleteLogDB(date);
      setLogs(prev => prev.filter(l => l.date !== date));
    } catch (e) {
      alert("削除に失敗しました: " + e.message);
    }
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
    <div className="pb-20">
      {/* Header Score */}
      <AppCard>
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {isPastEntry ? `📅 ${entry.date}（過去）` : `📅 ${entry.date} (今日)`}
            </div>
            <div className="text-xs text-gray-500 mt-1">記録済み {recordedCount}/20項目</div>
            {streak > 1 && (
              <div className="text-xs text-amber-600 font-medium mt-1">🔥 {streak}日連続記録中</div>
            )}
          </div>
          <ScoreBadge score={score} grade={grade} size="lg" />
        </div>
        <ScoreDetailPanel details={details} isHoliday={entry.isHoliday} />
        {score !== null && <XPostPanel entry={entry} score={score} grade={grade} />}
      </AppCard>

      {isPastEntry && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800">
          ⚠️ 過去のデータを編集中です。保存で上書きされます。
        </div>
      )}

      {/* Holiday Toggle */}
      <AppCard>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">休日モード</span>
          <button
            onClick={() => set("isHoliday", !entry.isHoliday)}
            className={cn(
              "px-4 py-2 min-h-[36px] rounded-full border-none cursor-pointer text-sm font-semibold transition-all duration-150 active:scale-95",
              entry.isHoliday ? "bg-violet-700 text-white" : "bg-gray-200 text-gray-700"
            )}
          >
            {entry.isHoliday ? "ON (休日)" : "OFF (平日)"}
          </button>
        </div>
        {entry.isHoliday && (
          <div className="text-xs text-gray-400 mt-1.5">
            休日時は「座位時間・座位中断・残業」をスコア除外
          </div>
        )}
      </AppCard>

      {/* Activity */}
      <AppCard title="🏃 活動" accent="#2563eb">
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
      </AppCard>

      {/* Sleep */}
      <AppCard title="😴 睡眠" accent="#7c3aed">
        <div className="flex gap-3 mb-4">
          <FieldRow label="起床時刻">
            <Input type="time" value={entry.wakeup} onChange={e => set("wakeup", e.target.value)} className="h-10 text-sm" />
          </FieldRow>
          <FieldRow label="就寝時刻">
            <Input type="time" value={entry.bedtime} onChange={e => set("bedtime", e.target.value)} className="h-10 text-sm" />
          </FieldRow>
        </div>
        {sleepH !== null && (
          <div className="text-sm text-gray-700 mb-3 px-3 py-2 bg-sky-50 rounded-xl border border-sky-100">
            睡眠時間: <strong>{sleepH}時間</strong>
            {sleepH >= 7 && sleepH <= 8
              ? <span className="text-green-600 font-medium"> ✓ 最適</span>
              : sleepH >= 6 ? <span className="text-amber-600 font-medium"> △ やや短い/長い</span> : <span className="text-red-600 font-medium"> ✕ 要改善</span>}
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
      </AppCard>

      {/* Nutrition */}
      <AppCard title="🥗 栄養・食事" accent="#16a34a">
        <FieldRow
          label="尿の色（水分補給状態）"
          hint="Armstrong尺度: 1-3=良好 ◎ / 4-5=やや不足 △ / 6-8=脱水 ✕"
        >
          <div className="flex gap-0.5">
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
                className={cn(
                  "flex-1 min-h-[36px] py-2 text-xs rounded-lg cursor-pointer transition-all duration-150 active:scale-95",
                  v >= 6 ? "text-white" : "text-gray-700",
                  entry.urineColor === v
                    ? "ring-2 ring-offset-1 ring-blue-500 scale-110 font-bold"
                    : "opacity-70 hover:opacity-100"
                )}
                style={{ background: bg }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
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
        <FieldRow label="コーヒー">
          <div className="flex items-center gap-3 mb-1">
            <Slider
              min={0}
              max={8}
              step={1}
              value={[entry.coffee]}
              onValueChange={([v]) => set("coffee", v)}
              className="flex-1"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={8}
                step={1}
                value={entry.coffee}
                onChange={e => set("coffee", Math.min(8, Math.max(0, Number(e.target.value) || 0)))}
                className="w-14 text-center px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400"
              />
              <span className="text-sm text-gray-500">杯</span>
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>0杯</span><span>4杯</span><span>8杯</span>
          </div>
          <CoffeeInfoPanel />
        </FieldRow>
      </AppCard>

      {/* Vitals */}
      <AppCard title="💊 体重・交流・食事時間" accent="#dc2626">
        <FieldRow label="体重" hint={settings.targetWeight ? `目標体重: ${settings.targetWeight}kg` : "設定タブで目標体重を設定"}>
          <div className="flex items-center gap-2">
            <NumberInput value={entry.weight} onChange={v => set("weight", v)} placeholder="例: 65.0" unit="kg" min={30} max={200} step={0.1} />
            {bmi && <span className="text-xs text-gray-500 whitespace-nowrap">BMI: {bmi}</span>}
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
          <Input
            type="time"
            value={entry.lastMealTime}
            onChange={e => set("lastMealTime", e.target.value)}
            className="h-10 text-sm"
          />
          <LastMealInfoPanel />
        </FieldRow>
      </AppCard>

      {/* Mental */}
      <AppCard title="🧠 メンタル・主観" accent="#f59e0b">
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
      </AppCard>

      {/* Work */}
      {!entry.isHoliday && (
        <AppCard title="💼 仕事" accent="#6b7280">
          <FieldRow label="残業時間" hint="目安: 60分未満 ◎">
            <NumberInput value={entry.overtime} onChange={v => set("overtime", v)} placeholder="例: 30" unit="分" min={0} />
          </FieldRow>
        </AppCard>
      )}

      {/* Memo */}
      <AppCard title="📝 メモ">
        <ImeTextarea
          value={entry.memo}
          onChange={v => set("memo", v)}
          placeholder="今日の気づき・体調メモ…"
          rows={3}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none box-border resize-y focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
        />
      </AppCard>

      {/* Date Jump */}
      <AppCard>
        <FieldRow label="別の日付を開く">
          <Input
            type="date"
            value={entry.date}
            max={todayStr()}
            onChange={e => loadDateEntry(e.target.value)}
            className="h-10 text-sm"
          />
        </FieldRow>
      </AppCard>

      {/* Save Button */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-white/90 backdrop-blur-sm border-t border-gray-100 z-[100]">
        <Button
          onClick={saveEntry}
          className="w-full rounded-xl text-base font-semibold min-h-[52px] h-auto transition-all duration-150 active:scale-95"
        >
          {isPastEntry ? "過去データを更新" : "今日の記録を保存"}
        </Button>
      </div>
    </div>
  );

  // ─── History Tab ────────────────────────────────────────────
  const HistoryTab = () => {
    const [filter, setFilter] = useState("all");
    const filtered = filter === "all" ? sortedLogs : sortedLogs.filter(l => l.isHoliday === (filter === "holiday"));
    return (
      <div className="pb-5">
        <div className="flex gap-2 mb-4">
          {[["all", "全て"], ["weekday", "平日"], ["holiday", "休日"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} className={cn(
              "px-4 py-2 min-h-[36px] rounded-full border text-sm cursor-pointer transition-all duration-150 active:scale-95",
              filter === v
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-gray-100 text-gray-500 border-gray-200"
            )}>{l}</button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 mt-10">記録がありません</div>
        )}
        {filtered.map(log => {
          const { score, grade } = calcHealthScore(log, sortedLogs.filter(l => l.date < log.date), settings);
          const sh = calcSleep(log.bedtime, log.wakeup);
          return (
            <div key={log.id} className="bg-white rounded-2xl px-4 py-3.5 mb-3 shadow-sm"
              style={{ borderLeft: grade ? `4px solid ${grade.color}` : "4px solid #e5e7eb" }}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-sm text-gray-900">
                    {log.date} {log.isHoliday ? "🏖" : ""}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {log.steps ? `👟 ${Number(log.steps).toLocaleString()}歩` : ""}
                    {sh ? ` 😴 ${sh}h` : ""}
                    {log.weight ? ` ⚖️ ${log.weight}kg` : ""}
                  </div>
                  {log.memo && <div className="text-xs text-gray-500 mt-0.5">{log.memo.slice(0, 40)}{log.memo.length > 40 ? "…" : ""}</div>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ScoreBadge score={score} grade={grade} size="sm" />
                  <div className="flex gap-1.5">
                    <button onClick={() => loadDateEntry(log.date)} className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg bg-gray-50 cursor-pointer text-gray-700 transition-all duration-150 active:scale-95">編集</button>
                    <button onClick={() => deleteLog(log.date)} className="text-xs px-2.5 py-1 border border-red-200 rounded-lg bg-red-50 cursor-pointer text-red-600 transition-all duration-150 active:scale-95">削除</button>
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
          <AppCard title="📈 健康スコア推移（直近）">
            <div className="flex items-end gap-1 h-20">
              {scoredLogs.map(l => (
                <div key={l.id} className="flex-1 flex flex-col items-center">
                  <div className="text-[9px] font-bold" style={{ color: l.grade?.color }}>{l.score}</div>
                  <div
                    className="w-full rounded-t-sm min-h-[4px]"
                    style={{
                      height: `${(l.score / maxScore) * 64}px`,
                      background: l.grade?.color || "#9ca3af",
                    }}
                  />
                  <div className="text-[8px] text-gray-400 mt-0.5">{l.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </AppCard>
        )}

        {/* Stats */}
        <AppCard title="📊 直近7日間の平均">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "歩数", val: avg7steps ? `${avg7steps.toLocaleString()}歩` : "—" },
              { label: "睡眠", val: avg7sleep ? `${avg7sleep}h` : "—" },
              { label: "体重", val: avg7weight ? `${avg7weight}kg` : "—" },
            ].map(({ label, val }) => (
              <div key={label} className="text-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="font-bold text-sm text-gray-900 mt-1">{val}</div>
              </div>
            ))}
          </div>
        </AppCard>

        {/* Score Grade Distribution */}
        {scoredLogs.length > 0 && (
          <AppCard title="🏅 グレード分布">
            {GRADE_THRESHOLDS.map(g => {
              const count = scoredLogs.filter(l => l.grade?.label === g.label).length;
              return (
                <div key={g.label} className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 font-bold text-sm" style={{ color: g.color }}>{g.label}</div>
                  <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                    {count > 0 && (
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${(count / scoredLogs.length) * 100}%`,
                          background: g.color,
                        }}
                      />
                    )}
                  </div>
                  <div className="text-xs text-gray-700 w-[30px] text-right">{count}日</div>
                </div>
              );
            })}
          </AppCard>
        )}

        {/* Streak */}
        <AppCard>
          <div className="text-center py-2">
            <div className="text-5xl font-black text-gray-900">🔥 {streak}</div>
            <div className="text-sm text-gray-500 mt-2">日連続記録</div>
          </div>
        </AppCard>
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
        <AppCard title="⚙️ 個人設定">
          <FieldRow label="身長 (cm)">
            <NumberInput value={localSettings.height || ""} onChange={v => setSetting("height", v)} placeholder="例: 170" unit="cm" />
          </FieldRow>
          <FieldRow label="目標体重 (kg)" hint="体重スコア計算に使用">
            <NumberInput value={localSettings.targetWeight || ""} onChange={v => setSetting("targetWeight", v)} placeholder="例: 65.0" unit="kg" step={0.1} />
          </FieldRow>
          <Button
            onClick={async () => { try { await saveSettingsDB(localSettings); setSettings(localSettings); alert("保存しました"); } catch(e) { alert("保存失敗: " + e.message); } }}
            className="w-full rounded-xl min-h-[44px] font-semibold"
          >
            設定を保存
          </Button>
        </AppCard>

        <AppCard title="📁 データ管理">
          <div className="flex flex-col gap-2.5">
            <Button
              onClick={exportData}
              className="w-full bg-green-700 hover:bg-green-800"
            >
              JSONエクスポート
            </Button>
            <Button
              onClick={() => fileRef.current?.click()}
              className="w-full bg-violet-700 hover:bg-violet-800"
            >
              JSONインポート
            </Button>
            <input type="file" accept=".json" ref={fileRef} onChange={importData} className="hidden" />
            <Button
              onClick={() => {
                if (confirm("全データを削除しますか？この操作は元に戻せません。")) {
                  setLogs([]);
                  alert("削除しました");
                }
              }}
              variant="destructive"
              className="w-full"
            >
              全データ削除
            </Button>
          </div>
        </AppCard>

        <AppCard title="📖 スコア説明">
          <div className="text-sm text-gray-700 leading-6">
            <div className="mb-2">
              健康スコアは<strong>20項目</strong>の記録を元に算出します。<br />
              各項目は0〜2段階で評価され、係数(★★★=3, ★★☆=2)で重み付けされます。
            </div>
            <div className="mb-2 text-xs text-gray-500 font-mono">スコア = Σ(段階×係数) ÷ Σ(最大段階×係数) × 100</div>
            <div className="mb-2 flex flex-wrap gap-2">
              {GRADE_THRESHOLDS.map(g => (
                <span key={g.label} className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ color: g.color, background: `${g.color}18` }}>
                  {g.label}: {g.min}点以上
                </span>
              ))}
            </div>
            <div className="text-xs text-gray-400">※ 10項目以上記録で表示 | 休日は座位・残業除外</div>
          </div>
        </AppCard>
      </div>
    );
  };

  // ─── Tab Bar ─────────────────────────────────────────────────
  const tabItems = [
    { id: "today", label: "記録" },
    { id: "history", label: "履歴" },
    { id: "insight", label: "分析" },
    { id: "settings", label: "設定" },
  ];

  if (loading) return (
    <div className="max-w-[480px] mx-auto font-sans min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">読み込み中...</div>
    </div>
  );

  return (
    <div className="max-w-[480px] mx-auto font-sans min-h-screen bg-gray-50">
      {/* Top Bar */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100 px-4 pt-3.5 pb-0">
        <div className="text-lg font-extrabold text-gray-900">🌿 HealthLog</div>
        <div className="flex mt-2 border-b border-gray-200">
          {tabItems.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 py-2.5 bg-transparent border-none cursor-pointer text-sm transition-colors",
                tab === t.id
                  ? "font-bold text-blue-600 border-b-2 border-blue-600"
                  : "font-normal text-gray-500 border-b-2 border-transparent"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-4">
        {tab === "today" && <TodayTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "insight" && <InsightTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
