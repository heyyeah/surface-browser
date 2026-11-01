// Layout of the VR menu's bookmark grid. Two columns, so a cell holds a usable
// title; rows never shrink below two lines of text. What does not fit scrolls.
//
// Pure: no canvas, no three.js.

const BOOKMARK_GRID_COLS = 2;
const BOOKMARK_CELL_MIN_H = 84;
const BOOKMARK_CELL_MAX_H = 112;

function bookmarkGridLayout({ count, height, gap, scrollRow = 0 }) {
  const rows = Math.ceil(count / BOOKMARK_GRID_COLS);
  const visibleRows = Math.max(1, Math.floor((height + gap) / (BOOKMARK_CELL_MIN_H + gap)));
  const shownRows = Math.min(rows, visibleRows);
  const maxScrollRow = Math.max(0, rows - visibleRows);
  const firstRow = Math.min(Math.max(0, scrollRow), maxScrollRow);
  const fitted = shownRows > 0 ? (height - gap * (shownRows - 1)) / shownRows : 0;
  return {
    cols: BOOKMARK_GRID_COLS,
    visibleRows,
    maxScrollRow,
    firstRow,
    cellH: Math.min(fitted, BOOKMARK_CELL_MAX_H),
    firstIndex: firstRow * BOOKMARK_GRID_COLS,
    endIndex: Math.min(count, (firstRow + shownRows) * BOOKMARK_GRID_COLS)
  };
}

// The second line of a Web cell. Null when it would only repeat the title.
function bookmarkUrlLine(value, title) {
  const short = String(value || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return short && short !== String(title || "").replace(/^www\./, "") ? short : null;
}

export { BOOKMARK_CELL_MIN_H, bookmarkGridLayout, bookmarkUrlLine };
