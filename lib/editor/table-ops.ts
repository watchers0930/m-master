interface CellInfo {
  el: HTMLTableCellElement;
  row: number;
  col: number;
  rowEnd: number;
  colEnd: number;
}

export function buildCellMap(table: HTMLTableElement): { grid: (CellInfo | null)[][]; cells: CellInfo[] } {
  const rows = Array.from(table.rows);
  const maxRows = rows.length;
  let maxCols = 0;
  rows.forEach(row => {
    let c = 0;
    Array.from(row.cells).forEach(cell => { c += cell.colSpan; });
    maxCols = Math.max(maxCols, c);
  });

  const grid: (CellInfo | null)[][] = Array.from({ length: maxRows }, () => new Array(maxCols).fill(null));
  const cells: CellInfo[] = [];

  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    Array.from(rows[r].cells).forEach(cell => {
      while (c < maxCols && grid[r][c] !== null) c++;
      const info: CellInfo = {
        el: cell as HTMLTableCellElement,
        row: r, col: c,
        rowEnd: r + cell.rowSpan - 1,
        colEnd: c + cell.colSpan - 1,
      };
      cells.push(info);
      for (let dr = 0; dr < cell.rowSpan; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          if (r + dr < maxRows && c + dc < maxCols) grid[r + dr][c + dc] = info;
        }
      }
      c += cell.colSpan;
    });
  }

  return { grid, cells };
}

export function getCellsInRange(
  table: HTMLTableElement,
  a: HTMLTableCellElement,
  b: HTMLTableCellElement,
): HTMLTableCellElement[] {
  const { grid, cells } = buildCellMap(table);
  const infoA = cells.find(c => c.el === a);
  const infoB = cells.find(c => c.el === b);
  if (!infoA || !infoB) return [a];

  const minRow = Math.min(infoA.row, infoB.row);
  const maxRow = Math.max(infoA.rowEnd, infoB.rowEnd);
  const minCol = Math.min(infoA.col, infoB.col);
  const maxCol = Math.max(infoA.colEnd, infoB.colEnd);

  const result = new Set<HTMLTableCellElement>();
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const info = grid[r]?.[c];
      if (info) result.add(info.el);
    }
  }
  return Array.from(result);
}

export function mergeCells(cells: HTMLTableCellElement[]): boolean {
  if (cells.length < 2) return false;
  const table = cells[0].closest('table') as HTMLTableElement | null;
  if (!table) return false;

  const { grid, cells: allCells } = buildCellMap(table);
  const infos = allCells.filter(i => cells.includes(i.el));
  if (infos.length < 2) return false;

  const minRow = Math.min(...infos.map(i => i.row));
  const maxRow = Math.max(...infos.map(i => i.rowEnd));
  const minCol = Math.min(...infos.map(i => i.col));
  const maxCol = Math.max(...infos.map(i => i.colEnd));

  // 직사각형 범위 내 모든 셀이 선택됐는지 검증
  const selSet = new Set(cells);
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const info = grid[r]?.[c];
      if (!info || !selSet.has(info.el)) return false;
    }
  }

  const firstCell = grid[minRow][minCol]!.el;
  const extraHtml = infos
    .filter(i => i.el !== firstCell)
    .map(i => i.el.innerHTML.trim())
    .filter(s => s && s !== '<br>')
    .join(' ');
  if (extraHtml) firstCell.innerHTML += ' ' + extraHtml;

  firstCell.colSpan = maxCol - minCol + 1;
  firstCell.rowSpan = maxRow - minRow + 1;

  const toRemove = new Set(infos.filter(i => i.el !== firstCell).map(i => i.el));
  toRemove.forEach(el => el.remove());
  Array.from(table.rows).forEach(row => { if (row.cells.length === 0) row.remove(); });

  return true;
}

export function splitCell(cell: HTMLTableCellElement): boolean {
  const colSpan = cell.colSpan;
  const rowSpan = cell.rowSpan;
  if (colSpan === 1 && rowSpan === 1) return false;

  const table = cell.closest('table') as HTMLTableElement | null;
  const tr = cell.parentElement as HTMLTableRowElement | null;
  if (!table || !tr) return false;

  const { cells: allCells } = buildCellMap(table);
  const info = allCells.find(i => i.el === cell);
  if (!info) return false;

  const STYLE = 'border:1px solid #cbd5e1;padding:6px 10px;min-width:60px;vertical-align:top;';

  cell.colSpan = 1;
  cell.rowSpan = 1;

  for (let c = 1; c < colSpan; c++) {
    const nc = document.createElement('td');
    nc.setAttribute('style', STYLE);
    tr.insertBefore(nc, tr.cells[cell.cellIndex + c] ?? null);
  }

  if (rowSpan > 1) {
    const trIndex = tr.rowIndex;
    for (let r = 1; r < rowSpan; r++) {
      const targetRow = table.rows[trIndex + r];
      if (!targetRow) continue;
      for (let c = 0; c < colSpan; c++) {
        const nc = document.createElement('td');
        nc.setAttribute('style', STYLE);
        let ref: Element | null = null;
        for (const existing of Array.from(targetRow.cells)) {
          const ei = allCells.find(i => i.el === existing);
          if (ei && ei.col >= info.col + c) { ref = existing; break; }
        }
        targetRow.insertBefore(nc, ref);
      }
    }
  }

  return true;
}
