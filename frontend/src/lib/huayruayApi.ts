/**
 * @file lib/huayruayApi.ts
 * @module lib/huayruayApi
 * @description Types สำหรับ external API response shapes
 *              Auth และ Profile ย้ายไปใช้ /api/auth (local backend แล้ว)
 */

export interface ApiMarketGroup {
  _id:        string
  groupTitle: string
  sort:       number
  status:     string
}

export interface ApiRound {
  _id:       string
  marketId:  string
  groupId:   string
  roundDate: { date: string; open: string; close: string }
  status:    string   // "Open" | "Close" | "Wait"
  note:      { groupTitle: string; marketTitle: string }
  market:    { _id: string; imageIcon?: string; sort?: number }
}

export interface ApiRoundBatch {
  groups: ApiMarketGroup[]
  rounds: ApiRound[]
}
