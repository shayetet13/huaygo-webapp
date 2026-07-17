/** Maps between external API category names and internal DB group names */
export const CATEGORY_TO_GROUP: Record<string, string> = {
  'หวยไทย':        'หวยไทย',
  'หวยต่างประเทศ': 'หวยต่างประเทศ',
  'หวยชุดนาน':     'หวยรายวัน',
  'หวยหุ้น':       'หวยหุ้น',
}

export const GROUP_TO_CATEGORY: Record<string, string> = {
  'หวยไทย':        'หวยไทย',
  'หวยต่างประเทศ': 'หวยต่างประเทศ',
  'หวยรายวัน':     'หวยชุดนาน',
  'หวยหุ้น':       'หวยหุ้น',
}

/** Sort order for market groups — matches /v3/market/group */
export const GROUP_SORT: Record<string, number> = {
  'หวยไทย':         1,
  'หวยต่างประเทศ':  2,
  'หวยรายวัน':      3,
  'หวยหุ้น':        4,
}
