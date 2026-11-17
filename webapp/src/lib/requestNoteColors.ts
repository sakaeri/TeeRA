// 出勤希望の日を、備考ごとに色分けする（備考なし＝青、備考ごとに紫・橙・水色、それ以上はグレー）。
// 休み希望の赤・シフト作成済みの緑と見分けやすい色だけを使う。
// 同じ日に備考の違う申請が重なった時は、新しく出した申請（後ろの方）の色にする。

export type NoteColor = { ring: string; label: string };

const NOTE_RINGS = ["ring-violet-500", "ring-orange-400", "ring-cyan-500"];
const NO_NOTE_RING = "ring-blue-400";
const OTHER_RING = "ring-gray-400";

export function buildWorkRequestColors(requests: { dates: string[]; note: string | null }[]) {
  const noteOrder: string[] = [];
  for (const r of requests) {
    const n = r.note?.trim();
    if (n && !noteOrder.includes(n)) noteOrder.push(n);
  }
  const ringForNote = (note: string | null) => {
    const n = note?.trim();
    if (!n) return NO_NOTE_RING;
    const i = noteOrder.indexOf(n);
    return i < NOTE_RINGS.length ? NOTE_RINGS[i] : OTHER_RING;
  };
  const byDate: Record<string, string> = {};
  for (const r of requests) for (const d of r.dates) byDate[d] = ringForNote(r.note);

  const legend: NoteColor[] = [];
  if (requests.some((r) => !r.note?.trim())) legend.push({ ring: NO_NOTE_RING, label: "出勤希望（備考なし）" });
  noteOrder.slice(0, NOTE_RINGS.length).forEach((n, i) => legend.push({ ring: NOTE_RINGS[i], label: `出勤希望（備考：${n}）` }));
  if (noteOrder.length > NOTE_RINGS.length) {
    legend.push({ ring: OTHER_RING, label: `出勤希望（その他の備考：${noteOrder.slice(NOTE_RINGS.length).join("／")}）` });
  }
  return { byDate, legend };
}
