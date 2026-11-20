export const WALL_NEED_HINT_IDS = ["right_now", "meet_people", "need_help", "looking_for", "buy_sell", "recommendation", "more"];

const LEGACY_WALL_HINT_IDS = new Map([
  ["tip:wk:now", "right_now"],
  ["tip:wk:Meet people", "meet_people"],
  ["tip:wk:help", "need_help"],
  ["tip:wk:look", "looking_for"],
  ["tip:wk:sell", "buy_sell"],
  ["tip:wk:rec", "recommendation"],
  ["tip:wk:more", "more"],
]);

export const normalizeWallNeedHintIds = (values = []) => [...new Set(values
  .map((value) => LEGACY_WALL_HINT_IDS.get(value) || value)
  .filter((value) => WALL_NEED_HINT_IDS.includes(value)))];
