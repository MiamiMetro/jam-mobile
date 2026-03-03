// Shared constants safe to import from both server and browser.
// No Convex server imports (`query`, `mutation`, etc.) allowed here.

export const ROOM_GENRES = [
  "LoFi",
  "Rock",
  "Metal",
  "Electronic",
  "Jazz",
  "Hip Hop",
  "Indie",
  "Classical",
  "R&B",
  "Reggae",
  "Ambient",
  "House",
  "Pop",
  "Acoustic",
] as const;

export type RoomGenre = (typeof ROOM_GENRES)[number];
