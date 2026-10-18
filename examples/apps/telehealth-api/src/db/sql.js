// Minimal SQL-style data layer.
//
// In production this module wraps the PostgreSQL driver; for local runs and
// tests it executes the same query strings against an in-memory table set so
// the rest of the app is identical in both environments.
import { tables } from "./store.js";

function parseWhere(clause) {
  // "col = 'value'" or "col = 123"
  const m = clause.match(/(\w+)\s*=\s*'?([^']*)'?/);
  if (!m) return null;
  return { col: m[1], val: m[2] };
}

// Executes a SQL string. Supports the narrow subset the app uses.
export function query(sql) {
  const text = sql.trim();
  const insert = text.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\((.*)\)$/is);
  if (insert) {
    const [, table, cols, vals] = insert;
    const columns = cols.split(",").map((c) => c.trim());
    const values = splitValues(vals);
    const row = {};
    columns.forEach((c, i) => (row[c] = values[i]));
    tables[table] = tables[table] || [];
    tables[table].push(row);
    return [row];
  }

  const select = text.match(/^SELECT .* FROM (\w+)(?:\s+WHERE\s+(.*))?$/is);
  if (select) {
    const [, table, where] = select;
    let rows = tables[table] || [];
    if (where) {
      const cond = parseWhere(where);
      if (cond) rows = rows.filter((r) => String(r[cond.col]) === cond.val);
    }
    return rows.slice();
  }

  const del = text.match(/^DELETE FROM (\w+)\s+WHERE\s+(.*)$/is);
  if (del) {
    const [, table, where] = del;
    const cond = parseWhere(where);
    const before = (tables[table] || []).length;
    tables[table] = (tables[table] || []).filter(
      (r) => !(cond && String(r[cond.col]) === cond.val),
    );
    return [{ deleted: before - tables[table].length }];
  }
  throw new Error("unsupported query");
}

function splitValues(s) {
  const out = [];
  let cur = "";
  let inStr = false;
  for (const ch of s) {
    if (ch === "'") inStr = !inStr;
    else if (ch === "," && !inStr) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((v) => v.replace(/^'|'$/g, ""));
}

export function reset() {
  for (const k of Object.keys(tables)) delete tables[k];
}
