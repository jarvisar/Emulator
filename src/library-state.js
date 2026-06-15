export function parseStoredList(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item) => typeof item === "string"))];
  } catch {
    return [];
  }
}

export function recordRecent(items, file, limit = 12) {
  if (!file) return items.slice(0, limit);
  return [file, ...items.filter((item) => item !== file)].slice(0, limit);
}

export function selectLibraryGames(games, mode, favorites, recents, query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  let selected;
  if (mode === "favorites") {
    selected = games.filter((game) => favorites.has(game.file));
  } else if (mode === "recent") {
    const byFile = new Map(games.map((game) => [game.file, game]));
    selected = recents.map((file) => byFile.get(file)).filter(Boolean);
  } else {
    selected = games;
  }
  return normalizedQuery
    ? selected.filter((game) => game.name.toLocaleLowerCase().includes(normalizedQuery))
    : selected;
}
