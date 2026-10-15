"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowRight, BookOpen, ChevronRight, CircleHelp, Database, Flame, RotateCcw, Search, Shield, Sparkles, Stars, Wind, X, Zap } from "lucide-react";
import { SPELLS, SPELL_FAMILIES } from "../lib/spells";
import { archiveIdentity, normalizeArchiveName } from "../lib/archive-identity";

type IdentityDialog = { kind: "confirm" | "rename"; key: string; origin: "intro" | "save"; startAfterConfirmation?: boolean };

async function queryArchiveIdentity(name: string, birthDate: string) {
  const response = await fetch("/api/archive/identity", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, birthDate }), cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json() as { exists?: boolean; error?: string };
  if (!response.ok || typeof payload.exists !== "boolean") throw new Error(payload.error ?? "云端档案查询失败，请重试。");
  return payload.exists;
}

function archiveRequestError(error: unknown, fallback: string) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "云端请求超时，请重试。";
  return error instanceof Error ? error.message : fallback;
}

type Trait = "fire" | "thunder" | "gravity" | "time" | "judgment";
type Answer = { text: string; traits: Partial<Record<Trait, number>> };
type PersonalQuestion = { id: string; title: string; note?: string; answers: Answer[] };
type ResonanceQuestion = { id: string; title: string; note: string; options: string[]; correct: number; points: number };
type HiddenQuestion = { id: string; title: string; options: string[]; freeTextOption?: number };
type Stage = "intro" | "personal" | "resonance" | "detection" | "branch" | "result";
type AudioPattern = "pairedPulse" | "loopingSpiral" | "branchingRise" | "hookedFall" | "mirrorEcho";
type AudioQuestion = { pattern: AudioPattern; label: string; title: string; options: number[]; correct: number };
type ArchiveRecord = {
  id: string;
  name: string;
  birthDate: string;
  location: string;
  createdAt: string;
  updatedAt: string;
  grade: string;
  gradeLabel: string;
  score: number;
  compositeScore: number;
  performancePercent: number | null;
  dominant: Trait;
  spell: string;
  character: string;
  hiddenTriggered: boolean;
  specialName: string | null;
  specialQuote: string | null;
};

const DETECTION_MESSAGE = "检测到疑似龙王级血统拥有者作答将进入隐藏分支";

let sharedAudioContext: AudioContext | null = null;

const personalQuestions: PersonalQuestion[] = [
  { id: "01", title: "第一次走进陌生的古老遗迹，你会先做什么？", note: "选择更接近你真实反应的一项。", answers: [
    { text: "点亮周围，确认所有出口", traits: { fire: 2, judgment: 1 } }, { text: "站在原地，先观察环境的变化", traits: { time: 2, gravity: 1 } }, { text: "找到最高处，俯瞰整座遗迹", traits: { thunder: 2, fire: 1 } }, { text: "触碰墙面，试着感受它留下的信息", traits: { judgment: 2, time: 1 } },
  ] },
  { id: "02", title: "当队友犯错，危险正在逼近，你会怎么做？", answers: [
    { text: "挡在最前面，把危险引到自己身上", traits: { fire: 2, gravity: 1 } }, { text: "让所有人停下，重新排布行动顺序", traits: { time: 2, gravity: 1 } }, { text: "在一瞬间抓住破绽，直接反击", traits: { thunder: 2, fire: 1 } }, { text: "先判断谁还值得信任，再决定出手", traits: { judgment: 2, time: 1 } },
  ] },
  { id: "03（1）", title: "哪一种力量感最让你感到熟悉？", answers: [
    { text: "灼热：燃烧、爆裂、把沉默撕开", traits: { fire: 3 } }, { text: "雷鸣：速度、决断、落下即终结", traits: { thunder: 3 } }, { text: "重力：秩序、压迫、让万物归位", traits: { gravity: 3 } }, { text: "时间：停顿、预见、在缝隙里改变结果", traits: { time: 3 } },
  ] },
  { id: "03（2）", title: "封闭建筑正在坍塌，你会用什么方式寻找出口？", answers: [
    { text: "直接破坏障碍物，强行开路", traits: { fire: 2, thunder: 1 } }, { text: "判断建筑结构，寻找最稳固的出口", traits: { gravity: 2, judgment: 1 } }, { text: "先确认声音、风向和外部动静", traits: { time: 2, judgment: 1 } }, { text: "利用水管、烟雾和环境制造机会", traits: { fire: 1, time: 1 } }, { text: "让其他人保持安静，集中精神寻找异常", traits: { judgment: 2, gravity: 1 } },
  ] },
  { id: "04", title: "如果你拥有一次改变局势的机会，你更想改变什么？", answers: [
    { text: "让敌人付出无法忽视的代价", traits: { fire: 1, thunder: 2 } }, { text: "让所有人停止互相伤害", traits: { gravity: 2, judgment: 1 } }, { text: "让某个已经失去的人重新回来", traits: { time: 2, judgment: 1 } }, { text: "让真相再也无法被隐藏", traits: { judgment: 3 } },
  ] },
  { id: "05（1）", title: "如果力量只能作用于一个尺度，你会选择？", answers: [
    { text: "近身五米：短促、炽烈、一次定胜负", traits: { fire: 2, thunder: 1 } }, { text: "一整片空间：让所有人感到我的存在", traits: { gravity: 2, judgment: 1 } }, { text: "一刹那之间：精准地切入关键节点", traits: { time: 2, thunder: 1 } }, { text: "对方的心：让他自己看见最害怕的东西", traits: { judgment: 2, gravity: 1 } },
  ] },
  { id: "05（2）", title: "下面哪种环境最接近你理想中的力量领域？", answers: [
    { text: "炽热、明亮、无法靠近", traits: { fire: 2 } }, { text: "厚重、坚固、无人能撼动", traits: { gravity: 2 } }, { text: "开阔、空旷、可以看见一切", traits: { thunder: 1, time: 1 } }, { text: "潮湿、流动、不断变化", traits: { time: 2 } }, { text: "安静、封闭、所有声音都能被控制", traits: { judgment: 2 } },
  ] },
  { id: "06", title: "力量越强，反噬越重。你会怎么使用它？", answers: [
    { text: "只在必须保护某个人时使用", traits: { gravity: 1, judgment: 2 } }, { text: "控制在可预测范围内，慢慢逼近极限", traits: { time: 2, gravity: 1 } }, { text: "既然已经选择，就不留后手", traits: { fire: 2, thunder: 1 } }, { text: "先找到代价的来源，再决定是否承担", traits: { judgment: 2, time: 1 } },
  ] },
];

const resonanceQuestions: ResonanceQuestion[] = [
  { id: "07", title: "记住左侧目标符文，5 秒后从四个选项中选出它。", note: "本题 20 分：先单独记忆目标符文，倒计时结束后才会显示四个实际选项。", options: [], correct: 0, points: 20 },
  { id: "08-1", title: "这个声音好像在哪里听过······", note: "音频结束后开放 7 秒作答时间。", options: [], correct: 0, points: 8 },
  { id: "08-2", title: "刚才的声音具有一定的节奏韵律，请选出与之相像的符号。", note: "音频结束后开放 7 秒作答时间。", options: [], correct: 2, points: 8 },
  { id: "08-3", title: "刚才的声音具有一定的节奏韵律，请选出与之相像的符号。", note: "音频结束后开放 7 秒作答时间。", options: [], correct: 0, points: 8 },
  { id: "08-4", title: "刚才的声音具有一定的节奏韵律，请选出与之相像的符号。", note: "音频结束后开放 7 秒作答时间。", options: [], correct: 2, points: 8 },
  { id: "08-5", title: "刚才的声音具有一定的节奏韵律，请选出与之相像的符号。", note: "音频结束后开放 7 秒作答时间。", options: [], correct: 3, points: 8 },
  { id: "09（2）", title: "请根据自己的想法选择补全后的符文图像。", note: "先观察完整结构，再完成这道补全题。", options: [], correct: 0, points: 25 },
  { id: "09（1）", title: "下列哪种对符文结构的描述是主体结构？", note: "请根据刚才 10 秒内记住的结构作答。", options: ["发散射线", "上下分布", "左右分布", "半包围", "螺旋线", "全包围"], correct: 4, points: 15 },
  { id: "10", title: "请填写最近一次大考或者绩效考核的百分比，如果不知道大概估一下，任何团体里占比皆可。", note: "请尽量准确，这将计入血统等级考量。", options: [], correct: 0, points: 0 },
];

type MemoryRow = { target: string; options: string[]; correct: number };
const memoryRows: MemoryRow[] = [
  { target: "/memory-v2/row01-target.png", options: ["/memory-v2/row01-option1.png", "/memory-v2/row01-option2.png", "/memory-v2/row01-option3.png", "/memory-v2/row01-option4.png"], correct: 2 },
  { target: "/memory-v2/row02-target.png", options: ["/memory-v2/row02-option1.png", "/memory-v2/row02-option2.png", "/memory-v2/row02-option3.png", "/memory-v2/row02-option4.png"], correct: 0 },
  { target: "/memory-v2/row03-target.png", options: ["/memory-v2/row03-option1.png", "/memory-v2/row03-option2.png", "/memory-v2/row03-option3.png", "/memory-v2/row03-option4.png"], correct: 0 },
  { target: "/memory-v2/row04-target.png", options: ["/memory-v2/row04-option1.png", "/memory-v2/row04-option2.png", "/memory-v2/row04-option3.png", "/memory-v2/row04-option4.png"], correct: 2 },
  { target: "/memory-v2/row05-target.png", options: ["/memory-v2/row05-option1.png", "/memory-v2/row05-option2.png", "/memory-v2/row05-option3.png", "/memory-v2/row05-option4.png"], correct: 2 },
  { target: "/memory-v2/row06-target.png", options: ["/memory-v2/row06-option1.png", "/memory-v2/row06-option2.png", "/memory-v2/row06-option3.png", "/memory-v2/row06-option4.png"], correct: 0 },
  { target: "/memory-v2/row07-target.png", options: ["/memory-v2/row07-option1.png", "/memory-v2/row07-option2.png", "/memory-v2/row07-option3.png", "/memory-v2/row07-option4.png"], correct: 3 },
  { target: "/memory-v2/row08-target.png", options: ["/memory-v2/row08-option1.png", "/memory-v2/row08-option2.png", "/memory-v2/row08-option3.png", "/memory-v2/row08-option4.png"], correct: 2 },
  { target: "/memory-v2/row09-target.png", options: ["/memory-v2/row09-option1.png", "/memory-v2/row09-option2.png", "/memory-v2/row09-option3.png", "/memory-v2/row09-option4.png"], correct: 0 },
  { target: "/memory-v2/row10-target.png", options: ["/memory-v2/row10-option1.png", "/memory-v2/row10-option2.png", "/memory-v2/row10-option3.png", "/memory-v2/row10-option4.png"], correct: 1 },
];

const audioQuestions: AudioQuestion[] = [
  { pattern: "pairedPulse", label: "镜像双拍", title: "镜像双拍", options: [2, 0, 3, 1], correct: 0 },
  { pattern: "loopingSpiral", label: "回旋滑音", title: "回旋滑音", options: [3, 1, 0, 2], correct: 2 },
  { pattern: "branchingRise", label: "分叉上行", title: "分叉上行", options: [1, 3, 2, 0], correct: 0 },
  { pattern: "hookedFall", label: "下坠回钩", title: "下坠回钩", options: [0, 2, 3, 1], correct: 2 },
  { pattern: "mirrorEcho", label: "镜像回声", title: "镜像回声", options: [3, 0, 1, 2], correct: 3 },
];

const hiddenQuestions: HiddenQuestion[] = [
  { id: "01", title: "以下哪一个描述符合自己的平时状态？", options: ["不愿出头，忍气吞声", "顺从他人，些许胆怯", "看到强者，心生自卑", "其他（请填写描述）"], freeTextOption: 3 },
  { id: "02", title: "在负面情绪情感中，以下哪种感觉最常见？", options: ["孤独", "恐惧", "其他（请填写描述）"], freeTextOption: 2 },
  { id: "03", title: "当你面前有一个龙王级的目标，会选择哪种战斗方式？", options: ["利用言灵效果", "直接刀剑肉搏", "使用强力武器"] },
  { id: "04", title: "对于背叛，你有怎样的经历？", options: ["背叛过别人", "被别人背叛", "没有经历过", "都经历过"] },
  { id: "05", title: "在一次多人合作中，大家意见不一致。你更可能怎么做？", options: ["直接确定一个方案，分配每个人的任务，让大家先按照同一规则行动。", "分别和关键的人沟通，改变他们的想法，让最终结果在不公开冲突的情况下变化。", "退出主动发表观点的人群，直接按照自己的想法最终完成任务。"] },
];

const traitLabels: Record<Trait, string> = { fire: "火元素亲和", thunder: "雷元素亲和", gravity: "重力控制", time: "时间感知", judgment: "审判意志" };
const profiles: Record<Trait, { spell: string; spellNumber: string; spellType: string; description: string; character: string; characterTag: string; characterDescription: string }> = {
  fire: { spell: "君焰", spellNumber: "序列号 89", spellType: "火元素 · 高危攻击型", description: "你对直接、炽烈且有边界的力量有天然亲和，释放时迅速改变战局。", character: "楚子航", characterTag: "狮心会 / 执行者", characterDescription: "沉默、精准，把失控锁在最后一秒之前。" },
  thunder: { spell: "雷池", spellNumber: "序列号 59", spellType: "雷元素 · 领域型", description: "你的力量倾向于制造高压环境，并在最短路径上完成决断。", character: "凯撒·加图索", characterTag: "学生会 / 领队者", characterDescription: "强烈的自我意志，在混乱中仍保持控制力。" },
  gravity: { spell: "王权", spellNumber: "序列号 91", spellType: "重力元素 · 控制型", description: "你擅长建立秩序，让周围的变量逐一沉降，规则会因你而改变。", character: "源稚生", characterTag: "日本分部 / 守门人", characterDescription: "背负传统与责任，在重压下仍努力保留人的形状。" },
  time: { spell: "时间零", spellNumber: "高阶领域", spellType: "时间元素 · 速度型", description: "你对节奏、缝隙和关键瞬间极其敏感，常常先半步改写结果。", character: "昂热", characterTag: "卡塞尔学院 / 校长", characterDescription: "把漫长岁月压缩成一记出鞘，果断而危险。" },
  judgment: { spell: "审判", spellNumber: "序列号 111", spellType: "雷电元素 · 终结型", description: "你对隐藏的真相与不可逆的选择有强烈感知，力量像一道宣判。", character: "绘梨衣", characterTag: "上杉家 / 红发巫女", characterDescription: "极高的纯度与破坏力，被安静地藏在透明的情感里。" },
};

const spellAffinityTerms: Record<Trait, string[]> = {
  fire: ["火", "炎", "灼", "爆破", "高温", "燃烧", "金属"],
  thunder: ["雷", "电", "风暴", "空气", "风", "速度", "爆破"],
  gravity: ["重力", "引力", "控制", "结界", "威压", "空间", "凝固", "硬化"],
  time: ["时间", "速度", "预知", "感知", "隐匿", "光学", "梦境", "解析"],
  judgment: ["审判", "裁决", "终结", "血统", "免疫", "权限", "支配", "吞噬"],
};
const undocumentedEffectMarkers = ["资料有限", "能力资料有限", "具体能力资料不完整", "具体效果仍待整理", "具体能力与归属待考"];
const bloodlineDangerCeiling: Record<string, number> = { S: 3, A: 2, B: 2, C: 1, D: 1, E: 0, F: 0 };
const dangerRank: Record<string, number> = { "低危": 0, "未详": 1, "中危": 1, "高危": 2, "绝密": 3 };

function chooseLibrarySpell(trait: Trait, resonanceScore: number, grade: string) {
  const terms = spellAffinityTerms[trait];
  const documentedSpells = SPELLS
    .filter((spell) => spell.summary.length >= 8 && !undocumentedEffectMarkers.some((marker) => spell.summary.includes(marker)))
    .map((spell) => ({ spell, risk: dangerRank[spell.danger] ?? 1 }));
  const allowedSpells = documentedSpells.filter(({ risk }) => risk <= (bloodlineDangerCeiling[grade] ?? 1));
  const pool = allowedSpells.length > 0 ? allowedSpells : documentedSpells;
  const candidates = pool
    .map((spell) => {
      const text = `${spell.spell.name} ${spell.spell.family} ${spell.spell.category} ${spell.spell.summary}`;
      const affinity = terms.reduce((total, term) => total + (text.includes(term) ? 4 : 0), 0);
      const confidence = spell.spell.confidence === "动画官方" || spell.spell.confidence === "已知序列" ? 2 : spell.spell.confidence === "动画推定" || spell.spell.confidence === "公开整理" ? 1 : 0;
      return { spell: spell.spell, rank: affinity + confidence };
    })
    .sort((left, right) => right.rank - left.rank || left.spell.name.localeCompare(right.spell.name, "zh-CN"));
  if (candidates.length === 0) return null;
  const highestRank = candidates[0].rank;
  const compatible = candidates.filter(({ rank }) => rank >= highestRank - 5).slice(0, 8);
  const scoreRatio = Math.max(0, Math.min(100, resonanceScore)) / 101;
  return compatible[Math.min(compatible.length - 1, Math.floor(scoreRatio * compatible.length))]?.spell ?? candidates[0].spell;
}

function gradeForScore(score: number) {
  if (score >= 90) return ["S", "龙王级共鸣"] as const;
  if (score >= 80) return ["A", "极高共鸣"] as const;
  if (score >= 68) return ["B", "高共鸣"] as const;
  if (score >= 55) return ["C", "稳定共鸣"] as const;
  if (score >= 40) return ["D", "低显性共鸣"] as const;
  if (score >= 20) return ["E", "微弱共鸣"] as const;
  return ["F", "未觉醒倾向"] as const;
}
function gradeWithThresholdReview(score: number, performancePercent: number) {
  const grades = [
    { grade: "S", label: "龙王级共鸣", floor: 90 }, { grade: "A", label: "极高共鸣", floor: 80 },
    { grade: "B", label: "高共鸣", floor: 68 }, { grade: "C", label: "稳定共鸣", floor: 55 },
    { grade: "D", label: "低显性共鸣", floor: 40 }, { grade: "E", label: "微弱共鸣", floor: 20 },
    { grade: "F", label: "未觉醒倾向", floor: 0 },
  ] as const;
  const currentIndex = grades.findIndex(({ floor }) => score >= floor);
  let index = currentIndex === -1 ? grades.length - 1 : currentIndex;
  let review = "绩效临界复核：维持当前档案";
  const higher = grades[index - 1];
  if (higher && score >= higher.floor - 3 && performancePercent < 15) {
    index -= 1;
    review = "绩效临界复核：满足上调条件";
  } else if (index < grades.length - 1 && score <= grades[index].floor + 2 && performancePercent > 85) {
    index += 1;
    review = "绩效临界复核：触发下调条件";
  }
  return { ...grades[index], review };
}
function traitFromAnswers(answers: number[]) {
  const scores: Record<Trait, number> = { fire: 0, thunder: 0, gravity: 0, time: 0, judgment: 0 };
  answers.forEach((index, questionIndex) => { const answer = personalQuestions[questionIndex]?.answers[index]; if (!answer) return; Object.entries(answer.traits).forEach(([trait, value]) => { scores[trait as Trait] += value ?? 0; }); });
  return (Object.keys(scores) as Trait[]).sort((a, b) => scores[b] - scores[a])[0] ?? "fire";
}
function Emblem({ trait }: { trait: Trait }) {
  const Icon = trait === "fire" ? Flame : trait === "thunder" ? Zap : trait === "gravity" ? Shield : trait === "time" ? Wind : Stars;
  return <div className={`emblem emblem-${trait}`}><Icon size={20} strokeWidth={1.5} /></div>;
}
function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") sharedAudioContext = new AudioContextClass();
  return sharedAudioContext;
}
function unlockAudioPlayback() {
  const context = getAudioContext();
  if (context && context.state === "suspended") void context.resume().catch(() => undefined);
}
function playAudioPattern(pattern: AudioPattern) {
  const context = getAudioContext();
  if (!context) return 1;
  void context.resume().catch(() => undefined);
  const start = context.currentTime + .04;
  const note = (offset: number, duration: number, from: number, to = from) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(from, start + offset);
    oscillator.frequency.linearRampToValueAtTime(to, start + offset + duration);
    gain.gain.setValueAtTime(.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(.22, start + offset + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, start + offset + duration);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start + offset); oscillator.stop(start + offset + duration + .03);
  };
  const patterns: Record<AudioPattern, { duration: number; notes: Array<[number, number, number, number?]> }> = {
    pairedPulse: { duration: 1.35, notes: [[0, .38, 220], [.68, .38, 220]] },
    loopingSpiral: { duration: 2.15, notes: [[0, 1.35, 205, 425], [1.35, .62, 425, 205]] },
    branchingRise: { duration: 1.25, notes: [[0, .88, 185, 290], [.56, .48, 290, 420], [.56, .48, 290, 535]] },
    hookedFall: { duration: 1.6, notes: [[0, 1.14, 455, 145], [1.02, .42, 160, 305]] },
    mirrorEcho: { duration: 1.7, notes: [[0, .32, 180, 265], [.48, .32, 265, 180], [1.02, .22, 180, 240], [1.28, .22, 240, 180]] },
  };
  const selection = patterns[pattern];
  selection.notes.forEach(([offset, duration, from, to]) => note(offset, duration, from, to));
  return selection.duration;
}
function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
function memoryImageStyle(source: string) {
  return {
    "--memory-image": `url("${source}")`,
  } as React.CSSProperties;
}
function audioSymbolStyle(symbol: number) {
  const asset = ["a", "b", "c", "d"][symbol] ?? "a";
  return {
    "--audio-symbol-image": `url("/dragon-audio-symbol-${asset}.png")`,
  } as React.CSSProperties;
}
function completionStyle(option: number) {
  return { backgroundPosition: `${(option % 2) * 100}% ${option > 1 ? 100 : 0}%` };
}
function AdaptiveDescription({ text }: { text: string }) {
  const clauses = text.match(/[^，。！？；：]+[，。！？；：]?/g) ?? [text];
  const longestClause = Math.max(...clauses.map((clause) => Array.from(clause).length));
  const density = longestClause >= 17 ? "description-compact" : longestClause >= 12 ? "description-tight" : "description-standard";
  return <p className={`card-description adaptive-description ${density}`}>{clauses.map((clause, index) => <span className="description-clause" key={`${clause}-${index}`}>{clause}</span>)}</p>;
}

export default function AssessmentPage() {
  const [stage, setStage] = useState<Stage>("intro");
  const [personalIndex, setPersonalIndex] = useState(0);
  const [resonanceIndex, setResonanceIndex] = useState(0);
  const [branchIndex, setBranchIndex] = useState(0);
  const [personalAnswers, setPersonalAnswers] = useState<number[]>([]);
  const [resonanceAnswers, setResonanceAnswers] = useState<number[]>([]);
  const [performanceScore, setPerformanceScore] = useState("");
  const [branchAnswers, setBranchAnswers] = useState<number[]>([]);
  const [branchNotes, setBranchNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detectionCharacters, setDetectionCharacters] = useState(0);
  const [memoryRow, setMemoryRow] = useState(0);
  const [memoryPhase, setMemoryPhase] = useState<"preview" | "choices">("preview");
  const [memorySeconds, setMemorySeconds] = useState(5);
  const [memoryOptions, setMemoryOptions] = useState<number[]>([0, 1, 2, 3]);
  const [audioPhase, setAudioPhase] = useState<"listening" | "answer">("listening");
  const [audioSeconds, setAudioSeconds] = useState(7);
  const [visionPhase, setVisionPhase] = useState<"preview" | "answer">("preview");
  const [visionSeconds, setVisionSeconds] = useState(10);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [location, setLocation] = useState("");
  const [identityStatus, setIdentityStatus] = useState<"idle" | "checking" | "clear" | "matched" | "confirmed" | "blocked" | "error">("idle");
  const [identityError, setIdentityError] = useState("");
  const [confirmedIdentity, setConfirmedIdentity] = useState<string | null>(null);
  const [identityDialog, setIdentityDialog] = useState<IdentityDialog | null>(null);
  const [replacementName, setReplacementName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [archiveSaveStatus, setArchiveSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [archiveSaveError, setArchiveSaveError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const identityChoiceRef = useRef<HTMLButtonElement>(null);
  const identityRequestRef = useRef(0);
  const blockedIdentityRef = useRef<string | null>(null);
  const newcomerNameRef = useRef<string | null>(null);
  const saveBlockedRef = useRef(false);
  const saveInFlightRef = useRef<symbol | null>(null);
  const submissionIdRef = useRef<string | null>(null);
  const testRunRef = useRef(0);
  const startingRef = useRef(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showArchiveLibrary, setShowArchiveLibrary] = useState(false);
  const [showArchiveAuth, setShowArchiveAuth] = useState(false);
  const [archiveUnlocked, setArchiveUnlocked] = useState(false);
  const [archivePassword, setArchivePassword] = useState("");
  const [archiveAuthError, setArchiveAuthError] = useState("");
  const [archiveLibraryError, setArchiveLibraryError] = useState("");
  const [archiveRecords, setArchiveRecords] = useState<ArchiveRecord[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFamily, setLibraryFamily] = useState<(typeof SPELL_FAMILIES)[number]>("全部");
  const currentResonance = resonanceQuestions[resonanceIndex];
  const selectedRef = useRef<number | null>(null);
  const savedArchiveRef = useRef<string | null>(null);
  const closeIdentityDialog = useCallback(() => {
    identityRequestRef.current += 1;
    setRenaming(false);
    setIdentityDialog(null);
    if (stage === "intro") nameInputRef.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (!identityDialog) return;
    if (identityDialog.kind === "rename") renameInputRef.current?.focus();
    else identityChoiceRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeIdentityDialog();
      if (event.key === "Tab") {
        const dialog = document.getElementById("identity-dialog");
        const controls = dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [identityDialog, closeIdentityDialog]);
  const audioQuestion = currentResonance?.id.startsWith("08") ? audioQuestions[resonanceIndex - 1] : undefined;
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const isPerformanceQuestion = stage === "resonance" && currentResonance?.id === "10";
  useEffect(() => {
    if (!isPerformanceQuestion) return;
    const value = Number(performanceScore);
    setSelected(performanceScore.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100 ? 0 : null);
  }, [isPerformanceQuestion, performanceScore]);
  useEffect(() => {
    if (stage !== "resonance" || currentResonance?.id !== "07") return;
    setMemoryRow(Math.floor(Math.random() * memoryRows.length));
    setMemoryOptions(shuffle([0, 1, 2, 3]));
    setMemoryPhase("preview");
    setMemorySeconds(5);
    setSelected(null);
    const timer = window.setInterval(() => {
      setMemorySeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          setMemoryPhase("choices");
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, resonanceIndex, currentResonance?.id]);
  useEffect(() => {
    if (stage !== "resonance" || !audioQuestion) return;
    setSelected(null);
    setAudioPhase("listening");
    setAudioSeconds(7);
    const duration = playAudioPattern(audioQuestion.pattern);
    const revealTimer = window.setTimeout(() => setAudioPhase("answer"), duration * 1000);
    return () => window.clearTimeout(revealTimer);
  }, [audioQuestion?.pattern, resonanceIndex, stage]);
  useEffect(() => {
    if (stage !== "resonance" || !audioQuestion || audioPhase !== "answer") return;
    const timer = window.setInterval(() => {
      setAudioSeconds((seconds) => {
        if (seconds > 1) return seconds - 1;
        window.clearInterval(timer);
        const next = [...resonanceAnswers];
        next[resonanceIndex] = selectedRef.current ?? -1;
        setResonanceAnswers(next);
        setSelected(null);
        if (resonanceIndex < resonanceQuestions.length - 1) setResonanceIndex(resonanceIndex + 1);
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [audioPhase, audioQuestion?.pattern, resonanceAnswers, resonanceIndex, stage]);
  useEffect(() => {
    if (stage !== "resonance" || currentResonance?.id !== "09（2）") return;
    setSelected(null);
    setVisionPhase("preview");
    setVisionSeconds(10);
    const timer = window.setInterval(() => {
      setVisionSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          setVisionPhase("answer");
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [currentResonance?.id, resonanceIndex, stage]);
  useEffect(() => {
    if (stage !== "detection") return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let visible = 0;
    let revealTimer: number | undefined;
    let transferTimer: number | undefined;
    const enterBranch = () => { setStage("branch"); setBranchIndex(0); setSelected(null); };
    const finishDetection = () => {
      setDetectionCharacters(Array.from(DETECTION_MESSAGE).length);
      transferTimer = window.setTimeout(enterBranch, 2000);
    };
    if (reducedMotion) {
      finishDetection();
    } else {
      setDetectionCharacters(0);
      revealTimer = window.setInterval(() => {
        visible += 1;
        setDetectionCharacters(visible);
        if (visible >= Array.from(DETECTION_MESSAGE).length) {
          window.clearInterval(revealTimer);
          finishDetection();
        }
      }, 70);
    }
    return () => {
      if (revealTimer !== undefined) window.clearInterval(revealTimer);
      if (transferTimer !== undefined) window.clearTimeout(transferTimer);
    };
  }, [stage]);
  const totalSteps = personalQuestions.length + resonanceQuestions.length;
  const currentStep = stage === "personal" ? personalIndex : personalQuestions.length + resonanceIndex;
  const progress = stage === "branch" ? 100 : Math.round((currentStep / totalSteps) * 100);
  const score = useMemo(() => resonanceAnswers.reduce((sum, answer, index) => {
    const correct = index === 0 ? answer === memoryOptions.indexOf(memoryRows[memoryRow]?.correct ?? 0) : answer === resonanceQuestions[index]?.correct;
    return sum + (correct ? resonanceQuestions[index]?.points ?? 0 : 0);
  }, 0), [memoryOptions, memoryRow, resonanceAnswers]);
  const hiddenTriggered = personalAnswers.join("") === "33240110";
  const performancePercent = Number(performanceScore);
  const hasPerformancePercent = Number.isFinite(performancePercent) && performancePercent >= 0 && performancePercent <= 100;
  const compositeScore = hasPerformancePercent ? Math.round(score * .85 + (100 - performancePercent) * .15) : score;
  const reviewedGrade = hiddenTriggered && hasPerformancePercent ? gradeWithThresholdReview(score, performancePercent) : null;
  const [grade, gradeLabel] = reviewedGrade ? [reviewedGrade.grade, reviewedGrade.label] : gradeForScore(compositeScore);
  const resultScore = hiddenTriggered ? score : compositeScore;
  const dominant = traitFromAnswers(personalAnswers);
  const librarySpell = useMemo(() => chooseLibrarySpell(dominant, resultScore, grade), [dominant, resultScore, grade]);
  const profile = useMemo(() => {
    const base = profiles[dominant];
    if (!librarySpell) return base;
    return {
      ...base,
      spell: librarySpell.name,
      spellNumber: librarySpell.serial === "未详" ? "言灵序列 · 未定" : `序列号 ${librarySpell.serial}`,
      spellType: `${librarySpell.family} · ${librarySpell.category}`,
      description: librarySpell.summary,
    };
  }, [dominant, librarySpell]);
  const special = useMemo(() => {
    if (!hiddenTriggered || grade !== "S") return null;
    const totals = { 皇帝: 0, 神谕: 0, 未知: 0 };
    branchAnswers.forEach((answer, index) => { const maps = [["皇帝", "神谕", "皇帝", "未知"], ["皇帝", "神谕", "未知"], ["神谕", "皇帝", "未知"], ["神谕", "皇帝", "未知", "未知"], ["皇帝", "神谕", "未知"]]; const key = maps[index]?.[answer] as keyof typeof totals | undefined; if (key) totals[key] += 1; });
    const winner = (Object.keys(totals) as (keyof typeof totals)[]).sort((a, b) => totals[b] - totals[a])[0] ?? "未知";
    return { name: winner, quote: winner === "皇帝" ? "吾重临世界之日，诸逆臣皆当死去" : winner === "神谕" ? "凡王之血必以剑终" : "档案库中尚未记载，高危人物" };
  }, [branchAnswers, grade, hiddenTriggered]);
  const saveArchive = useCallback(async (mode?: "new" | "retest") => {
    if (stage !== "result" || !name.trim() || !birthDate || saveInFlightRef.current || saveBlockedRef.current) return;
    const key = archiveIdentity(name, birthDate);
    if (savedArchiveRef.current === key) return;
    const requestId = Symbol();
    const run = testRunRef.current;
    saveInFlightRef.current = requestId;
    submissionIdRef.current ??= crypto.randomUUID();
    setArchiveSaveStatus("saving");
    setArchiveSaveError("");
    const now = new Date().toISOString();
    const record: ArchiveRecord = {
      id: "DRG-" + Date.now().toString(36).toUpperCase(), name: name.trim(), birthDate, location: location.trim(),
      createdAt: now, updatedAt: now, grade, gradeLabel, score, compositeScore,
      performancePercent: hasPerformancePercent ? performancePercent : null, dominant, spell: profile.spell,
      character: profile.character, hiddenTriggered, specialName: special?.name ?? null, specialQuote: special?.quote ?? null,
    };
    try {
      const response = await fetch("/api/archive", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ ...record, archiveMode: mode ?? (confirmedIdentity === key ? "retest" : "new"), submissionId: submissionIdRef.current }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string; error?: string };
      if (testRunRef.current !== run) return;
      if (response.status === 409 && payload.code === "IDENTITY_CONFLICT") {
        saveBlockedRef.current = true;
        setArchiveSaveStatus("conflict");
        setArchiveSaveError("发现相同ID和生日的档案，请确认身份后收录。");
        setIdentityDialog({ kind: "confirm", key, origin: "save" });
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "云端档案保存失败，请重试。");
      savedArchiveRef.current = key;
      setArchiveSaveStatus("saved");
    } catch (error) {
      if (testRunRef.current === run) {
        setArchiveSaveStatus("error");
        setArchiveSaveError(archiveRequestError(error, "云端档案保存失败，请重试。"));
      }
    } finally {
      if (saveInFlightRef.current === requestId) saveInFlightRef.current = null;
    }
  }, [birthDate, compositeScore, confirmedIdentity, dominant, grade, gradeLabel, hasPerformancePercent, hiddenTriggered, location, name, performancePercent, profile.character, profile.spell, score, special, stage]);
  useEffect(() => { if (stage === "result") void saveArchive(); }, [saveArchive, stage]);
  const filteredSpells = useMemo(() => SPELLS.filter((spell) => (libraryFamily === "全部" || spell.family === libraryFamily) && [spell.name, spell.serial, spell.category, spell.holder, spell.source ?? ""].join(" ").toLowerCase().includes(libraryQuery.trim().toLowerCase())), [libraryFamily, libraryQuery]);
  const profileComplete = name.trim().length > 0 && birthDate.length > 0;
  const fetchArchiveRecords = async () => {
    setArchiveLibraryError("");
    try {
      const response = await fetch("/api/archive", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { records?: ArchiveRecord[]; error?: string };
      if (response.status === 401) {
        setArchiveUnlocked(false);
        setShowArchiveLibrary(false);
        setShowArchiveAuth(true);
        throw new Error(payload.error ?? "管理员会话已失效，请重新验证。");
      }
      if (!response.ok) throw new Error(payload.error ?? "云端档案读取失败。");
      setArchiveRecords(Array.isArray(payload.records) ? payload.records : []);
      return true;
    } catch (error) {
      setArchiveLibraryError(error instanceof Error ? error.message : "云端档案读取失败。");
      return false;
    }
  };
  const openArchiveLibrary = () => {
    if (archiveUnlocked) { setShowArchiveLibrary(true); void fetchArchiveRecords(); }
    else { setArchivePassword(""); setArchiveAuthError(""); setShowArchiveAuth(true); }
  };
  const unlockArchiveLibrary = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setArchiveAuthError("");
    try {
      const response = await fetch("/api/archive/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: archivePassword }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "密码不正确，无法进入档案库。");
      setArchiveUnlocked(true); setShowArchiveAuth(false); setShowArchiveLibrary(true); setArchivePassword("");
      await fetchArchiveRecords();
    } catch (error) {
      setArchiveAuthError(error instanceof Error ? error.message : "密码不正确，无法进入档案库。");
    }
  };
  const deleteArchiveRecord = async (record: ArchiveRecord) => {
    if (!archiveUnlocked || typeof window === "undefined") return;
    if (!window.confirm(`确定删除“${record.name}”的血统档案吗？此操作无法撤销。`)) return;
    try {
      const response = await fetch("/api/archive", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "档案删除失败。");
      setArchiveRecords((current) => current.filter((item) => item.id !== record.id));
    } catch (error) {
      setArchiveLibraryError(error instanceof Error ? error.message : "档案删除失败。");
    }
  };
  const clearIdentityDecision = () => {
    identityRequestRef.current += 1;
    setConfirmedIdentity(null); setIdentityStatus("idle"); setIdentityError(""); setIdentityDialog(null);
  };
  const reset = () => {
    testRunRef.current += 1; savedArchiveRef.current = null; saveInFlightRef.current = null;
    submissionIdRef.current = null; saveBlockedRef.current = false; blockedIdentityRef.current = null; newcomerNameRef.current = null;
    clearIdentityDecision(); setArchiveSaveStatus("idle"); setArchiveSaveError("");
    setStage("intro"); setPersonalIndex(0); setResonanceIndex(0); setBranchIndex(0); setPersonalAnswers([]); setResonanceAnswers([]); setPerformanceScore(""); setBranchAnswers([]); setBranchNotes([]); setDetectionCharacters(0); setSelected(null);
  };
  const beginTest = () => {
    testRunRef.current += 1; savedArchiveRef.current = null; saveInFlightRef.current = null;
    submissionIdRef.current = crypto.randomUUID(); saveBlockedRef.current = false;
    setArchiveSaveStatus("idle"); setArchiveSaveError("");
    unlockAudioPlayback(); setStage("personal"); setPersonalIndex(0); setResonanceIndex(0); setPersonalAnswers([]); setResonanceAnswers([]); setPerformanceScore(""); setBranchAnswers([]); setBranchNotes([]); setDetectionCharacters(0); setSelected(null);
  };
  const checkIdentity = async (startAfterConfirmation = false) => {
    if (!profileComplete || identityDialog) return false;
    const key = archiveIdentity(name, birthDate);
    if (blockedIdentityRef.current === key || newcomerNameRef.current === normalizeArchiveName(name)) {
      setIdentityStatus("blocked"); setIdentityError("此ID已被占用，请您更换ID");
      nameInputRef.current?.focus(); return false;
    }
    const request = ++identityRequestRef.current;
    setIdentityStatus("checking"); setIdentityError("");
    try {
      const exists = await queryArchiveIdentity(name, birthDate);
      if (request !== identityRequestRef.current) return false;
      if (exists && confirmedIdentity !== key) {
        setIdentityStatus("matched");
        setIdentityDialog({ kind: "confirm", key, origin: "intro", startAfterConfirmation });
        return false;
      }
      setIdentityStatus(exists ? "confirmed" : "clear");
      return true;
    } catch (error) {
      if (request === identityRequestRef.current) {
        setIdentityStatus("error");
        setIdentityError(archiveRequestError(error, "云端档案查询失败，请重试。"));
      }
      return false;
    }
  };
  const checkIdentityOnBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    // The start button performs its own fresh check in the click handler.
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute("data-start-test")) return;
    if (identityStatus !== "checking") void checkIdentity();
  };
  const start = async () => {
    if (!profileComplete || identityStatus === "checking" || startingRef.current || identityDialog) return;
    startingRef.current = true;
    unlockAudioPlayback();
    try { if (await checkIdentity(true)) beginTest(); }
    finally { startingRef.current = false; }
  };
  const chooseRetest = () => {
    if (!identityDialog || identityDialog.key !== archiveIdentity(name, birthDate)) return;
    setConfirmedIdentity(identityDialog.key); blockedIdentityRef.current = null; newcomerNameRef.current = null;
    setIdentityStatus("confirmed"); setIdentityError(""); setIdentityDialog(null);
    if (identityDialog.origin === "save") {
      saveBlockedRef.current = false;
      void saveArchive("retest");
    } else if (identityDialog.startAfterConfirmation) beginTest();
    else nameInputRef.current?.focus();
  };
  const chooseNewcomer = () => {
    if (!identityDialog) return;
    blockedIdentityRef.current = identityDialog.key;
    newcomerNameRef.current = normalizeArchiveName(name);
    setConfirmedIdentity(null); setIdentityStatus("blocked");
    setIdentityError("此ID已被占用，请您更换ID");
    if (identityDialog.origin === "save") {
      setReplacementName(""); setRenameError("此ID已被占用，请您更换ID");
      setIdentityDialog({ ...identityDialog, kind: "rename" });
    } else { setIdentityDialog(null); nameInputRef.current?.focus(); }
  };
  const renameAndSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renaming || !identityDialog || !replacementName.trim()) return;
    const nextName = replacementName.trim();
    const key = archiveIdentity(nextName, birthDate);
    if (key === blockedIdentityRef.current || newcomerNameRef.current === normalizeArchiveName(nextName)) { setRenameError("此ID已被占用，请您更换ID"); return; }
    const request = ++identityRequestRef.current;
    setRenaming(true); setRenameError("");
    try {
      const exists = await queryArchiveIdentity(nextName, birthDate);
      if (request !== identityRequestRef.current) return;
      if (exists) { setRenameError("此ID已被占用，请您更换ID"); return; }
      submissionIdRef.current = crypto.randomUUID();
      saveBlockedRef.current = false; blockedIdentityRef.current = null; newcomerNameRef.current = null;
      setIdentityDialog(null); setConfirmedIdentity(null); setIdentityStatus("clear"); setIdentityError("");
      setName(nextName); // Changing the name re-runs result saving with all answers preserved.
    } catch (error) {
      if (request === identityRequestRef.current) setRenameError(archiveRequestError(error, "云端档案查询失败，请重试。"));
    } finally { if (request === identityRequestRef.current) setRenaming(false); }
  };
  const commitAnswer = () => {
    if (selected === null) return;
    if (stage === "personal") {
      const next = [...personalAnswers]; next[personalIndex] = selected; setPersonalAnswers(next);
      if (personalIndex < personalQuestions.length - 1) { setPersonalIndex(personalIndex + 1); setSelected(next[personalIndex + 1] ?? null); } else { setStage("resonance"); setResonanceIndex(0); setSelected(null); }
    } else if (stage === "resonance") {
      const next = [...resonanceAnswers]; next[resonanceIndex] = selected; setResonanceAnswers(next);
      if (resonanceIndex < resonanceQuestions.length - 1) { setResonanceIndex(resonanceIndex + 1); setSelected(next[resonanceIndex + 1] ?? null); } else if (next.length === resonanceQuestions.length && next.every((value) => value !== undefined)) { setStage(hiddenTriggered ? "detection" : "result"); setBranchIndex(0); setSelected(null); }
    } else if (stage === "branch") {
      const next = [...branchAnswers]; next[branchIndex] = selected; setBranchAnswers(next);
      if (branchIndex < hiddenQuestions.length - 1) { setBranchIndex(branchIndex + 1); setSelected(next[branchIndex + 1] ?? null); } else { setStage("result"); setSelected(null); }
    }
  };
  const goBack = () => {
    if (stage === "personal") { if (personalIndex === 0) setStage("intro"); else { setPersonalIndex(personalIndex - 1); setSelected(personalAnswers[personalIndex - 1] ?? null); } }
    else if (stage === "resonance") { if (audioQuestion || (currentResonance?.id === "09（2）" && visionPhase === "preview")) return; if (resonanceIndex === 0) { setStage("personal"); setSelected(personalAnswers.at(-1) ?? null); } else { setResonanceIndex(resonanceIndex - 1); setSelected(resonanceAnswers[resonanceIndex - 1] ?? null); } }
    else if (stage === "branch") { if (branchIndex === 0) { setStage("resonance"); setResonanceIndex(resonanceQuestions.length - 1); setSelected(resonanceAnswers.at(-1) ?? null); } else { setBranchIndex(branchIndex - 1); setSelected(branchAnswers[branchIndex - 1] ?? null); } }
  };
  const answerOptions = stage === "personal" ? personalQuestions[personalIndex]?.answers : stage === "branch" ? hiddenQuestions[branchIndex]?.options.map((text) => ({ text, traits: {} })) : currentResonance?.options.map((text) => ({ text, traits: {} }));
  const isTimedAudio = stage === "resonance" && Boolean(audioQuestion);
  const isVisionPreview = stage === "resonance" && currentResonance?.id === "09（2）" && visionPhase === "preview";
  const displayTitle = isVisionPreview ? "观察下列符文结构" : stage === "personal" ? personalQuestions[personalIndex]?.title : stage === "resonance" ? currentResonance?.title : hiddenQuestions[branchIndex]?.title;
  const displayNote = isVisionPreview ? `记忆窗口剩余 ${visionSeconds} 秒。符文将收回后进入补全题。` : stage === "personal" ? personalQuestions[personalIndex]?.note : stage === "resonance" ? currentResonance?.note : "附加题不计入龙文共鸣总分，仅用于特殊档案倾向判断。";
  const isCompactTitle = displayTitle === "以下哪一个描述符合自己的平时状态？" || displayTitle === "当你面前有一个龙王级的目标，会选择哪种战斗方式？" || displayTitle === "对于背叛，你有怎样的经历？" || displayTitle === "第一次走进陌生的古老遗迹，你会先做什么？" || displayTitle === "当队友犯错，危险正在逼近，你会怎么做？" || displayTitle === "哪一种力量感最让你感到熟悉？" || displayTitle === "封闭建筑正在坍塌，你会用什么方式寻找出口？" || displayTitle === "如果你拥有一次改变局势的机会，你更想改变什么？" || displayTitle === "如果力量只能作用于一个尺度，你会选择？" || displayTitle === "力量越强，反噬越重。你会怎么使用它？";
  const isLogoTitle = displayTitle === "下面哪种环境最接近你理想中的力量领域？";
  const displayTitleNode = displayTitle === "请填写最近一次大考或者绩效考核的百分比，如果不知道大概估一下，任何团体里占比皆可。" ? <><span className="question-title-q10-main">请填写最近一次大考或者绩效考核的百分比</span><span className="question-title-q10-hint">如果不知道大概估一下，任何团体里占比皆可。</span></> : displayTitle === "在负面情绪情感中，以下哪种感觉最常见？" ? <><span className="question-title-branch02-first">在负面情绪情感中，</span><br /><span className="question-title-branch02-second">以下哪种感觉最常见？</span></> : displayTitle === "在一次多人合作中，大家意见不一致。你更可能怎么做？" ? <><span className="question-title-branch05-first">在一次多人合作中，大家意见不一致。</span><br /><span className="question-title-branch05-second">你更可能怎么做？</span></> : displayTitle === "记住左侧目标符文，5 秒后从四个选项中选出它。" ? <><span className="question-title-q07-first">记住左侧目标符文，</span><br /><span className="question-title-q07-second">5 秒后从四个选项中选出它。</span></> : displayTitle === "当你面前有一个龙王级的目标，会选择哪种战斗方式？" ? <>当你面前有一个龙王级的目标，<br />你会选择哪种战斗方式？</> : displayTitle === "对于背叛，你有怎样的经历？" ? <>对于背叛，<br /><span className="question-title-indent">你有怎样的经历？</span></> : displayTitle === "第一次走进陌生的古老遗迹，你会先做什么？" ? <>第一次走进陌生的古老遗迹，<br /><span className="question-title-right">你会先做什么？</span></> : displayTitle === "当队友犯错，危险正在逼近，你会怎么做？" ? <><span className="question-title-q02-first">当队友犯错，危险正在逼近，</span><br /><span className="question-title-q02-second">你会怎么做？</span></> : displayTitle === "封闭建筑正在坍塌，你会用什么方式寻找出口？" ? <>封闭建筑正在坍塌，<br /><span className="question-title-right">你会用什么方式寻找出口？</span></> : displayTitle === "如果你拥有一次改变局势的机会，你更想改变什么？" ? <><span className="question-title-center">如果你拥有一次改变局势的机会</span><br /><span className="question-title-center">你更想改变什么？</span></> : displayTitle === "如果力量只能作用于一个尺度，你会选择？" ? <><span className="question-title-center">如果力量只能作用于一个尺度</span><br /><span className="question-title-center">你会选择？</span></> : displayTitle === "力量越强，反噬越重。你会怎么使用它？" ? <><span className="question-title-q06-first">力量越强，反噬越重。</span><br /><span className="question-title-q06-second">你会怎么使用它？</span></> : displayTitle;
  return <main className="app-shell"><div className="grain" aria-hidden="true" /><div className="ambient-rune ambient-rune-a" aria-hidden="true" /><div className="ambient-rune ambient-rune-b" aria-hidden="true" />
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span>ᛉ</span></div><div><p className="brand-kicker">CASSEL ARCHIVE / 0.6</p><p className="brand-name">龙族血统测试局</p></div></div><div className="topbar-actions"><button className="method-link" onClick={openArchiveLibrary}><Archive size={16} /><span>档案库 · 管理员</span></button><button className="method-link" onClick={() => setShowLibrary(true)}><Database size={16} /><span>言灵库 · {SPELLS.length}</span></button><button className="method-link" onClick={() => setShowMethodology(true)}><BookOpen size={16} /><span>测评逻辑</span></button></div></header>
    <div className="layout-grid"><aside className="left-rail" aria-label="测试说明"><div className="rail-caption">ARCHIVE NOTE</div><div className="rail-line" /><p>个人直觉与龙文共鸣分开记录。共鸣模块决定血统评级，隐藏分支只在触发时出现。</p><div className="rail-stamp">NO. 001 / PERSONAL</div></aside>
      <section className="main-panel">
        {stage === "intro" && <div className="intro-view fade-in"><div className="intro-copy"><div className="status-chip"><span className="status-dot" />档案接口已就绪</div><p className="section-kicker">THE DRAGON HERITAGE INDEX</p><h1>你的血统，<br /><em>会说出什么？</em></h1><div className="intro-stats"><span><strong>16</strong> 个基础题</span><span><strong>S–F</strong> 血统评级</span><span><strong>受限</strong> 档案库</span></div>
          <div className="profile-fields">
            <label><span>档案称呼</span><input ref={nameInputRef} value={name} maxLength={80} onChange={(event) => { clearIdentityDecision(); setName(event.target.value); }} onBlur={checkIdentityOnBlur} placeholder="例如：路明非" /></label>
            <label><span>出生日期</span><input type="date" value={birthDate} onChange={(event) => { clearIdentityDecision(); setBirthDate(event.target.value); }} onBlur={checkIdentityOnBlur} /></label>
            <label><span>所在城市</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="可选" /></label>
          </div>
          <button className="primary-button" data-start-test onClick={() => void start()} disabled={!profileComplete || identityStatus === "checking" || identityStatus === "blocked" || Boolean(identityDialog)} title={!profileComplete ? "请先填写档案称呼和出生日期" : undefined}>{identityStatus === "checking" ? "正在核对档案…" : "开始测试"} <ArrowRight size={18} /></button>
          <p className="microcopy" role="status">{identityError || (identityStatus === "checking" ? "正在查询云端档案，请稍候" : identityStatus === "confirmed" ? "已确认血统重测 · 完成后更新原档案" : profileComplete ? "档案信息已就绪 · 开始前将核对云端档案" : "请先填写档案称呼和出生日期")}</p>
          {identityStatus === "error" && <button className="back-button" onClick={() => void checkIdentity()}>重新查询档案</button>}
        </div><div className="intro-instrument" aria-label="言灵序列表视觉示意"><div className="instrument-glow" /><div className="element-particles" aria-hidden="true"><span className="element-particle particle-fire" /><span className="element-particle particle-thunder" /><span className="element-particle particle-gravity" /><span className="element-particle particle-time" /><span className="element-particle particle-judgment" /><span className="element-particle particle-fire" /><span className="element-particle particle-thunder" /><span className="element-particle particle-gravity" /><span className="element-particle particle-time" /><span className="element-particle particle-judgment" /><span className="element-particle particle-fire" /><span className="element-particle particle-thunder" /><span className="element-particle particle-gravity" /><span className="element-particle particle-time" /><span className="element-particle particle-judgment" /><span className="element-particle particle-fire" /><span className="element-particle particle-thunder" /><span className="element-particle particle-gravity" /><span className="element-particle particle-time" /><span className="element-particle particle-judgment" /></div><div className="instrument-ring ring-outer" /><div className="instrument-ring ring-mid" /><div className="instrument-core"><Sparkles size={27} /><span>言灵<br />序列</span></div><div className="instrument-orbit"><div className="instrument-label label-top"><span>龙文共鸣 <strong>S–F</strong></span></div><div className="instrument-label label-right"><span>隐藏分支 <strong>?</strong></span></div><div className="instrument-label label-bottom"><span>言灵适配 <strong>—</strong></span></div><div className="instrument-label label-left"><span>档案识别 <strong>—</strong></span></div></div></div></div>}
        {(stage === "personal" || stage === "resonance" || stage === "branch") && <div className="quiz-view resonance-view fade-in"><div className="quiz-head"><div><p className="section-kicker">{stage === "personal" ? "PERSONAL THOUGHTS" : stage === "resonance" ? "DRAGON TEXT RESONANCE" : "RESTRICTED BRANCH"}</p><div className="progress-track"><span style={{ width: `${Math.max(8, progress)}%` }} /></div></div><span className="progress-label">{stage === "personal" ? `${personalIndex + 1} / ${personalQuestions.length}` : stage === "resonance" ? `${personalQuestions.length + resonanceIndex + 1} / ${totalSteps}` : `${branchIndex + 1} / ${hiddenQuestions.length}`}</span></div>
          <div className="question-block"><p className="question-eyebrow">{stage === "personal" ? personalQuestions[personalIndex]?.id : stage === "resonance" ? currentResonance?.id : hiddenQuestions[branchIndex]?.id}</p><h1 className={`${isCompactTitle ? "question-title-compact" : ""}${isLogoTitle ? " question-title-with-logo" : ""}`.trim() || undefined}>{displayTitleNode}</h1><p className="question-note">{displayNote}</p>
            {stage === "resonance" && currentResonance?.id === "07" && <div className="memory-question">
              {memoryPhase === "preview" ? <div className="memory-preview"><div className="memory-rune memory-target" style={memoryImageStyle(memoryRows[memoryRow]?.target ?? memoryRows[0].target)} /><strong>目标符文记忆中 · {memorySeconds} 秒</strong></div> : <div className="memory-choices"><p>目标符文已遮盖，请选择你刚才记住的符文。</p><div className="memory-option-grid">{memoryOptions.map((optionIndex, index) => <button className={`memory-option ${selected === index ? "is-selected" : ""}`} key={optionIndex} onClick={() => setSelected(index)} role="radio" aria-checked={selected === index}><span className="memory-rune" style={memoryImageStyle(memoryRows[memoryRow]?.options[optionIndex] ?? memoryRows[0].options[optionIndex])} /><b>{String.fromCharCode(65 + index)}</b></button>)}</div></div>}
            </div>}
            {isTimedAudio && <div className="audio-question">{audioPhase === "listening" ? <div className="audio-listening"><span className="audio-pulse" /><strong>龙文回响播放中</strong><p>{audioQuestion?.label} · 请专心聆听，音频结束后开放作答。</p><button className="audio-orb" onClick={() => audioQuestion && playAudioPattern(audioQuestion.pattern)}><span>◉</span>重播当前回响</button></div> : <div className="audio-answer"><div className="audio-answer-head"><span>作答剩余 {audioSeconds} 秒</span><p>请选择与刚才声音最接近的符文。图片对应的是题库中的图形，而非选项序号。</p></div><div className="audio-symbol-grid" role="radiogroup">{audioQuestion?.options.map((symbol, index) => <button className={`audio-symbol-option ${selected === index ? "is-selected" : ""}`} key={symbol} onClick={() => setSelected(index)} role="radio" aria-checked={selected === index}><span className="audio-symbol" style={audioSymbolStyle(symbol)} /><b>{String.fromCharCode(65 + index)}</b></button>)}</div></div>}</div>}
            {stage === "resonance" && currentResonance?.id === "09（2）" && <div className="vision-question">{visionPhase === "preview" ? <div className="vision-preview"><div className="vision-crop"><img src="/灵视延迟回忆字符-加强版.svg" alt="待记忆的龙文结构" /></div><strong>龙文结构记忆中 · {visionSeconds} 秒</strong></div> : <div className="completion-question"><div className="completion-source"><img src="/灵视字符Y-残缺补全题.svg" alt="残缺龙文字符" /></div><p>请选择你认为正确的补全方式。</p><div className="completion-option-grid" role="radiogroup">{[0, 1, 2, 3].map((option) => <button className={`completion-option ${selected === option ? "is-selected" : ""}`} key={option} onClick={() => setSelected(option)} role="radio" aria-checked={selected === option}><span className="completion-rune" style={completionStyle(option)} /><b>{String.fromCharCode(65 + option)}</b></button>)}</div></div>}</div>}
            {isPerformanceQuestion && <label className="performance-question"><span>绩效／考核百分比</span><div><input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={performanceScore} onChange={(event) => setPerformanceScore(event.target.value)} placeholder="例如：12" /><b>%</b></div><p>请尽量准确，这将计入血统等级考量。</p></label>}
            {!(stage === "resonance" && (currentResonance?.id === "07" || isTimedAudio || currentResonance?.id === "09（2）" || isPerformanceQuestion)) && <><div className="answer-list" role="radiogroup">{answerOptions?.map((answer, index) => <button className={`answer-card ${selected === index ? "is-selected" : ""}`} key={answer.text} onClick={() => setSelected(index)} role="radio" aria-checked={selected === index}><span className="answer-index">{String.fromCharCode(65 + index)}</span><span>{answer.text}</span><ChevronRight className="answer-arrow" size={18} /></button>)}</div>{stage === "branch" && selected === hiddenQuestions[branchIndex]?.freeTextOption && <label className="branch-note"><span>补充描述</span><input value={branchNotes[branchIndex] ?? ""} onChange={(event) => setBranchNotes((notes) => { const next = [...notes]; next[branchIndex] = event.target.value; return next; })} placeholder="请填写你的描述（仅用于本次档案）" /></label>}</>}
          </div>{isTimedAudio ? <div className="timed-audio-footer"><span>本题将在倒计时结束后自动进入下一段回响</span><strong>{audioPhase === "listening" ? "播放中" : `${audioSeconds}s`}</strong></div> : <div className="quiz-actions">{!isVisionPreview && <button className="back-button" onClick={goBack}><ArrowLeft size={17} /> 上一题</button>}<button className="primary-button compact" disabled={selected === null || (stage === "resonance" && currentResonance?.id === "07" && memoryPhase === "preview") || isVisionPreview} onClick={commitAnswer}>{stage === "resonance" && currentResonance?.id === "07" && memoryPhase === "preview" ? `记忆中 ${memorySeconds}s` : isVisionPreview ? `观察中 ${visionSeconds}s` : stage === "branch" && branchIndex === hiddenQuestions.length - 1 ? "查看档案" : stage === "resonance" && resonanceIndex === resonanceQuestions.length - 1 ? "查看档案" : "下一题"} <ArrowRight size={17} /></button></div>}</div>}
        {stage === "detection" && <section className="detection-view fade-in" aria-live="polite" aria-label="隐藏血统检测中"><div className="detection-corner detection-corner-a" aria-hidden="true" /><div className="detection-corner detection-corner-b" aria-hidden="true" /><div className="detection-sigil detection-sigil-outer" aria-hidden="true" /><div className="detection-sigil detection-sigil-inner" aria-hidden="true" /><div className="detection-emblem" aria-hidden="true" /><p className="detection-message" aria-label={DETECTION_MESSAGE}>{Array.from(DETECTION_MESSAGE).map((character, index) => <span className={index < detectionCharacters ? "is-visible" : ""} aria-hidden="true" key={`${character}-${index}`}>{character}</span>)}</p></section>}
        {stage === "result" && <div className="result-view fade-in"><div className="result-topline"><span>PERSONAL FILE / COMPLETE</span><span>ARCHIVE 06 · 2026</span></div><div className="result-hero"><div><p className="section-kicker">{name ? `${name} 的测试档案` : "你的测试档案"}</p><h1>血统评级 <span>{grade}</span></h1><p className="result-label">{gradeLabel} <span>·</span> 龙文共鸣 {score} / 100 <span>·</span> {hiddenTriggered ? `绩效临界复核 ${performancePercent}%` : `综合评分 ${compositeScore} / 100`}</p></div><div className="result-stamp" aria-label={`血统评级 ${grade}`}><span>CASSEL ARCHIVE</span><strong>{grade}</strong><i>血统评级 / VERIFIED</i></div></div>
          <div className="result-grid"><div className="result-card spell-card"><div className="card-heading"><span>PRIMARY SPIRIT</span><span>{profile.spellNumber}</span></div><div className="spell-display"><Emblem trait={dominant} /><div><h2>{profile.spell}</h2><p>{profile.spellType}</p></div></div><AdaptiveDescription text={profile.description} /><div className="meter-row"><span>适配度</span><div className="meter"><span style={{ width: `${Math.min(96, 56 + resultScore * .4)}%` }} /></div><strong>{Math.min(96, Math.round(56 + resultScore * .4))}%</strong></div></div><div className="result-card character-card"><div className="card-heading"><span>RESONANT PROFILE</span><span>ROLE MATCH</span></div><p className="match-caption">最接近你的角色气质</p><h2>{profile.character}</h2><p className="character-tag">{profile.characterTag}</p><AdaptiveDescription text={profile.characterDescription} /><div className="trait-chip"><Sparkles size={14} /> {traitLabels[dominant]}</div></div></div>
          <div className="identity-strip"><div><span>龙文共鸣</span><strong>{score} <small>/ 100</small></strong></div><div><span>{hiddenTriggered ? "绩效临界复核" : "综合评分"}</span><strong>{hiddenTriggered ? `${performancePercent}%` : `${compositeScore} / 100`}</strong></div><div><span>主要亲和</span><strong>{traitLabels[dominant]}</strong></div><div><span>档案编号</span><strong>DRG-{String(resultScore).padStart(3, "0")}</strong></div></div>
          {hiddenTriggered && <div className={`special-result ${special ? "is-special" : ""}`}><div className="special-mark">{special ? "✦" : "—"}</div><div><span className="special-kicker">RESTRICTED BLOODLINE FILE</span><h2>{special ? `特殊血统倾向 · ${special.name}` : "特殊血统倾向"}</h2><p>{special ? `“${special.quote}”` : "您的共鸣程度不高，我们初步推断您并未觉醒龙王血统"}</p></div></div>}
          <div className={`archive-save-status archive-save-${archiveSaveStatus}`} role="status">
            <span>{archiveSaveStatus === "saving" ? "正在收录云端档案…" : archiveSaveStatus === "saved" ? "档案已收录至云端" : archiveSaveError}</span>
            {archiveSaveStatus === "error" && <button className="back-button" onClick={() => void saveArchive()}>重试保存</button>}
            {archiveSaveStatus === "conflict" && <button className="back-button" onClick={() => setIdentityDialog({ kind: "confirm", key: archiveIdentity(name, birthDate), origin: "save" })}>确认档案身份</button>}
          </div>
          <div className="result-footer"><p><CircleHelp size={16} /> 本结果是基于公开设定整理的角色化推演，不代表官方认证。</p><button className="back-button" onClick={reset}><RotateCcw size={16} /> 重新测试</button></div></div>}
      </section>
      <aside className="right-rail" aria-label="五部小说参考"><div className="rail-caption">THE CHRONICLES</div><div className="book-stack">{["Ⅰ 火之晨曦", "Ⅱ 悼亡者之瞳", "Ⅲ 黑月之潮", "Ⅳ 奥丁之渊", "Ⅴ 悼亡者的归来"].map((book, index) => <div className={`book book-${index + 1}`} key={book}><span>{book}</span><i /></div>)}</div><p className="right-note">五部正传中出现过的言灵与人物倾向，被整理成这份测试的灵感索引。</p></aside>
    </div><footer className="footer-bar"><span>© DRAGON HERITAGE INDEX</span><span>非官方粉丝向体验 · 仅供娱乐</span></footer>
    {identityDialog && <div className="modal-backdrop identity-backdrop" role="presentation" onClick={closeIdentityDialog}>
      <div className="archive-auth-modal identity-modal" id="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-title" aria-describedby="identity-description" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={closeIdentityDialog} aria-label="关闭身份确认"><X size={18} /></button>
        <p className="section-kicker">CASSEL ARCHIVE / IDENTITY CHECK</p>
        <h2 id="identity-title">{identityDialog.kind === "rename" ? "新生档案登记" : "屠龙者身份确认"}</h2>
        {identityDialog.kind === "confirm" ? <>
          <p id="identity-description">尊敬的屠龙者，你是血统重测人还是第一次新生测试者？</p>
          <div className="identity-actions">
            <button ref={identityChoiceRef} type="button" className="primary-button compact" onClick={chooseRetest}>血统重测人 <RotateCcw size={17} /></button>
            <button type="button" className="identity-newcomer-button" onClick={chooseNewcomer}>新生测试者 <ArrowRight size={17} /></button>
          </div>
        </> : <form onSubmit={(event) => void renameAndSave(event)}>
          <p id="identity-description" className="identity-rename-description">此ID已被占用，请您更换ID。已完成的答题结果会保留。</p>
          <label className="archive-password-field"><span>新的档案称呼</span><input ref={renameInputRef} value={replacementName} maxLength={80} disabled={renaming} onChange={(event) => { setReplacementName(event.target.value); setRenameError(""); }} placeholder="请输入新的ID" /></label>
          <p className="identity-birthday">出生日期 · {birthDate}</p>
          {renameError && <p className="archive-auth-error" role="alert">{renameError}</p>}
          <button type="submit" className="primary-button compact" disabled={renaming || !replacementName.trim()}>{renaming ? "正在核对档案…" : "核对并保存档案"} <ArrowRight size={17} /></button>
        </form>}
      </div>
    </div>}
    {showArchiveAuth && <div className="modal-backdrop" role="presentation" onClick={() => setShowArchiveAuth(false)}><form className="archive-auth-modal" role="dialog" aria-modal="true" aria-labelledby="archive-auth-title" onSubmit={unlockArchiveLibrary} onClick={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setShowArchiveAuth(false)} aria-label="关闭"><X size={18} /></button><p className="section-kicker">RESTRICTED ARCHIVE / ADMIN ONLY</p><h2 id="archive-auth-title">管理员验证</h2><p>档案库包含测试者个人资料与测评结果，请输入管理员密码。</p><label className="archive-password-field"><span>访问密码</span><input type="password" autoFocus value={archivePassword} onChange={(event) => { setArchivePassword(event.target.value); setArchiveAuthError(""); }} placeholder="输入管理员密码" /></label>{archiveAuthError && <p className="archive-auth-error">{archiveAuthError}</p>}<button className="primary-button compact" type="submit">验证并进入 <ArrowRight size={17} /></button></form></div>}
    {showArchiveLibrary && <div className="modal-backdrop" role="presentation" onClick={() => setShowArchiveLibrary(false)}><div className="archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowArchiveLibrary(false)} aria-label="关闭"><X size={18} /></button><div className="library-heading"><div><p className="section-kicker">ARCHIVE / BLOODLINE FILES</p><h2 id="archive-title">血统档案库 <span>{archiveRecords.length} 份云端档案</span></h2></div></div>{archiveLibraryError && <p className="archive-auth-error">{archiveLibraryError}</p>}{archiveRecords.length === 0 ? <div className="archive-empty"><Archive size={28} /><p>档案库目前为空。</p></div> : <div className="archive-grid">{archiveRecords.map((record) => <article className="archive-card" key={record.id}><div className="archive-card-top"><span>{record.id}</span><div className="archive-card-actions"><button className="archive-delete-button" type="button" onClick={() => deleteArchiveRecord(record)} aria-label={`删除 ${record.name} 的档案`}>删除档案</button><strong>{record.grade}</strong></div></div><h3>{record.name}</h3><p className="archive-meta">出生日期 · {record.birthDate.replaceAll("-", "/")}</p><p className="archive-meta">最后更新 · {record.updatedAt.slice(0, 10).replaceAll("-", "/")}</p><div className="archive-card-result"><span>{record.spell} · {record.gradeLabel}</span><b>{record.score} / 100</b></div><p className="archive-card-detail">{record.character}{record.specialName ? ` · 特殊倾向：${record.specialName}` : ""}</p></article>)}</div>}</div></div>}
    {showMethodology && <div className="modal-backdrop" role="presentation" onClick={() => setShowMethodology(false)}><div className="method-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowMethodology(false)} aria-label="关闭"><X size={18} /></button><p className="section-kicker">REFERENCE NOTE / 002</p><h2>本次测评逻辑</h2><p>个人直觉题只用于判定元素亲和、领域偏好和隐藏触发条件；龙文共鸣题独立计分，按 100 分换算 S–F 血统等级。</p><div className="method-list"><div><span>01</span><p>个人题完成后，与龙文共鸣题一起检查隐藏触发序列。</p></div><div><span>02</span><p>触发隐藏序列才会出现附加题；附加题不计入共鸣总分。</p></div><div><span>03</span><p>只有共鸣达到 S 级，附加题才会落入皇帝、神谕或未知三种特殊倾向。</p></div></div><button className="primary-button compact" onClick={() => setShowMethodology(false)}>了解 <ArrowRight size={17} /></button></div></div>}
    {showLibrary && <div className="modal-backdrop" role="presentation" onClick={() => setShowLibrary(false)}><div className="library-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowLibrary(false)} aria-label="关闭"><X size={18} /></button><div className="library-heading"><div><p className="section-kicker">ARCHIVE / SPELL INDEX</p><h2 id="library-title">言灵档案库 <span>{filteredSpells.length} / {SPELLS.length}</span></h2></div><p>已收录正传相关设定与黑天鹅港动画补充条目。</p></div><div className="library-controls"><label className="library-search"><Search size={16} /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索言灵、角色、属性或来源" /></label><select value={libraryFamily} onChange={(event) => setLibraryFamily(event.target.value as (typeof SPELL_FAMILIES)[number])}>{SPELL_FAMILIES.map((family) => <option key={family}>{family}</option>)}</select></div><div className="spell-library-grid">{filteredSpells.map((spell) => <article className="spell-index-card" key={spell.name + "-" + spell.serial}><div className="spell-card-top"><span className="spell-serial">{spell.serial}</span><span className={"spell-confidence confidence-" + (spell.confidence === "已知序列" || spell.confidence === "动画官方" ? "known" : spell.confidence === "公开整理" ? "public" : "unknown")}>{spell.confidence}</span></div><h3>{spell.name}</h3><p className="spell-meta">{spell.family} · {spell.category}</p><p>{spell.summary}</p>{spell.source && <p className="spell-source">{spell.source}</p>}<div className="spell-card-bottom"><span>{spell.holder}</span><strong>{spell.danger}</strong></div></article>)}</div>{filteredSpells.length === 0 && <div className="library-empty">没有找到匹配的言灵档案。</div>}</div></div>}
  </main>;
}
