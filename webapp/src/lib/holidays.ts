// 日本の祝日判定（「国民の祝日に関する法律」のルールから計算する）。
// 外部データに頼らず、固定日・ハッピーマンデー・春分/秋分（天文計算の
// 近似式）・振替休日・国民の休日を求める。即位礼のような一度きりの祝日や
// 五輪特措法での移動は SPECIAL_* で個別に扱う（新たに決まったら追記する）。
// 日付は "YYYY-MM-DD"（JSTの暦日）で扱う。

const SPECIAL_HOLIDAYS: Record<string, string> = {
  "2019-04-30": "国民の休日",
  "2019-05-01": "天皇の即位の日",
  "2019-05-02": "国民の休日",
  "2019-10-22": "即位礼正殿の儀の行われる日",
};

// 東京五輪の年は海の日・スポーツの日・山の日が移動した（通常ルールの日は平日）
const MOVED_HOLIDAYS: Record<number, Record<string, string>> = {
  2020: { "07-23": "海の日", "07-24": "スポーツの日", "08-10": "山の日" },
  2021: { "07-22": "海の日", "07-23": "スポーツの日", "08-08": "山の日" },
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// その月の第n月曜日の日付
function nthMonday(year: number, month: number, n: number) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (n - 1) * 7;
}

function vernalEquinoxDay(year: number) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year: number) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 振替休日・国民の休日を除いた「祝日そのもの」
function baseHolidays(year: number): Map<string, string> {
  const h = new Map<string, string>();
  const add = (m: number, d: number, name: string) => h.set(`${year}-${pad(m)}-${pad(d)}`, name);

  add(1, 1, "元日");
  add(1, nthMonday(year, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  if (year >= 2020) add(2, 23, "天皇誕生日");
  add(3, vernalEquinoxDay(year), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  add(9, nthMonday(year, 9, 3), "敬老の日");
  add(9, autumnalEquinoxDay(year), "秋分の日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");
  if (year <= 2018) add(12, 23, "天皇誕生日");

  const moved = MOVED_HOLIDAYS[year];
  if (moved) {
    for (const [md, name] of Object.entries(moved)) h.set(`${year}-${md}`, name);
  } else {
    add(7, nthMonday(year, 7, 3), "海の日");
    add(10, nthMonday(year, 10, 2), year >= 2020 ? "スポーツの日" : "体育の日");
    if (year >= 2016) add(8, 11, "山の日");
  }

  for (const [date, name] of Object.entries(SPECIAL_HOLIDAYS)) {
    if (date.startsWith(`${year}-`)) h.set(date, name);
  }
  return h;
}

const cache = new Map<number, Map<string, string>>();

function holidaysOfYear(year: number): Map<string, string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const base = baseHolidays(year);
  const all = new Map(base);
  const dateStr = (d: Date) => d.toISOString().slice(0, 10);

  for (const date of Array.from(base.keys()).sort()) {
    const d = new Date(`${date}T00:00:00Z`);
    // 振替休日：祝日が日曜なら、その後の最初の祝日でない日が休日
    if (d.getUTCDay() === 0) {
      const next = new Date(d);
      do {
        next.setUTCDate(next.getUTCDate() + 1);
      } while (all.has(dateStr(next)));
      all.set(dateStr(next), "振替休日");
    }
    // 国民の休日：前後を祝日に挟まれた平日
    const twoAhead = new Date(d);
    twoAhead.setUTCDate(twoAhead.getUTCDate() + 2);
    const between = new Date(d);
    between.setUTCDate(between.getUTCDate() + 1);
    if (base.has(dateStr(twoAhead)) && !all.has(dateStr(between)) && between.getUTCDay() !== 0) {
      all.set(dateStr(between), "国民の休日");
    }
  }

  cache.set(year, all);
  return all;
}

// 祝日名（祝日でなければnull）
export function holidayName(dateStr: string): string | null {
  const year = Number(dateStr.slice(0, 4));
  return holidaysOfYear(year).get(dateStr) ?? null;
}

// 土日祝の単価を使う日か（土曜・日曜・祝日）
export function isWeekendOrHoliday(dateStr: string): boolean {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 || holidayName(dateStr) !== null;
}
