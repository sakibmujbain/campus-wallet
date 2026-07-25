import React from "react";

// Renders a plain-text description as tidy paragraphs. It respects the line breaks the
// author typed (blank line → new paragraph, single newline → line break, "- " lines →
// bullet list). For a pasted run-on with NO line breaks it makes one safe split — a new
// paragraph before each itinerary "Day N" marker — so long blurbs stop being a wall.
function structure(text: string): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (t.includes("\n")) return t; // author already formatted it — don't second-guess
  return tidyText(t); // pasted run-on: same split the editor's "Tidy up" would apply
}

const BULLET = /^\s*[-*•]\s+/;

/** Editor helper behind the "Tidy up" button: turn a pasted run-on blurb into paragraphs
 *  by breaking before each "Day N" marker and before Title-Case "Label:" segments. This is
 *  heuristic, so it is deliberately NOT applied at render time — the author sees the result
 *  in the textarea and can cancel before saving. */
export function tidyText(text: string): string {
  const flat = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (flat === "") return "";
  return flat
    .replace(/ *\n */g, "\n")                        // tidy existing breaks
    .replace(/([^\n]) +(?=Day \d+\b)/g, "$1\n\n")    // itinerary days
    // Title-Case labels ("Tour Dates:", "Primary Registration Fee:"). We capture the
    // preceding word and skip the break when it is itself Title-Case — otherwise the
    // scan would split the label's own words ("Tour" / "Dates:") and never settle.
    // Requiring [A-Z][a-z]+ per word also keeps "BDT" and "He said:" out.
    .replace(
      /(\S+) +([A-Z][a-z]+(?: [A-Z][a-z]+){0,3}:)(?=[ \n]|$)/g,
      (m, prev: string, label: string) => (/^[A-Z][a-z]*$/.test(prev) ? m : `${prev}\n\n${label}`),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A block may mix a heading line with bullets (e.g. "Day 1\n- ...\n- ..."), so we walk
// the lines and group runs of bullet lines into <ul> while other lines become <p>.
function renderBlock(block: string, key: number): React.ReactNode {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  const flushBullets = () => {
    if (bullets.length) { out.push(<ul key={`u${out.length}`}>{bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>); bullets = []; }
  };
  const flushPara = () => {
    if (para.length) {
      const p = para;
      out.push(<p key={`p${out.length}`}>{p.map((l, j) => <React.Fragment key={j}>{l}{j < p.length - 1 ? <br /> : null}</React.Fragment>)}</p>);
      para = [];
    }
  };
  for (const l of lines) {
    if (BULLET.test(l)) { flushPara(); bullets.push(l.replace(BULLET, "")); }
    else { flushBullets(); para.push(l); }
  }
  flushPara(); flushBullets();
  return <React.Fragment key={key}>{out}</React.Fragment>;
}

export function FormattedText({ text, className }: { text: string; className?: string }) {
  const blocks = structure(text).split(/\n{2,}/).filter((b) => b.trim() !== "");
  return <div className={className}>{blocks.map((b, i) => renderBlock(b, i))}</div>;
}
