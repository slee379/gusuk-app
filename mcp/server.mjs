#!/usr/bin/env node
/* 좋아하는 구석 — MCP 서버
 *
 * 앱이 "폴더 저장" 모드로 쓰는 볼트를 Claude 가 읽고 쓸 수 있게 열어준다.
 *
 *   node server.mjs "<볼트폴더경로>"
 *   GUSUK_VAULT="<경로>" node server.mjs
 *
 * 볼트 구조 (앱이 만든다):
 *   <볼트>/tags.json          {app,v,updatedAt,tags:[{name,cat}]}
 *   <볼트>/notes/<id>.json    사진 한 장의 메모·태그
 *   <볼트>/images/<id>.<ext>  사진 원본
 *
 * ── 앱과 충돌하지 않기 위한 규칙 ────────────────────────────
 * 1. 노트를 쓸 때 updatedAt 을 반드시 현재 시각으로 올린다.
 *    앱은 updatedAt 이 자기 것보다 큰 노트만 받아들인다. 안 올리면 조용히 무시된다.
 * 2. 읽고-고치고-쓰기. 모르는 필드도 그대로 보존한다.
 * 3. 노트 파일을 지우지 않는다. 앱이 그걸 "사진 삭제"로 해석한다.
 * 4. 파일 이름은 항상 <id>.json 이고 안의 id 와 같아야 한다. 아니면 앱이 건너뛴다.
 *
 * 의존성 없음. JSON-RPC 를 직접 구현했다 — npm install 이 필요 없다.
 */
import {
  readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const SERVER = { name: "gusuk-archive", version: "1.0.0" };
const CATS = {
  color: "색", material: "소재", light: "빛·조명", object: "가구·오브제",
  structure: "구조·배치", mood: "분위기", detail: "디테일", etc: "기타",
};

/* ── 볼트 위치 ─────────────────────────────────────────── */
const VAULT = resolve(process.argv[2] || process.env.GUSUK_VAULT || "");
function vaultProblem() {
  if (!process.argv[2] && !process.env.GUSUK_VAULT)
    return "볼트 폴더를 알려주지 않았습니다. 실행 인자나 GUSUK_VAULT 환경변수로 경로를 주세요.";
  if (!existsSync(VAULT)) return "폴더가 없습니다: " + VAULT;
  if (!existsSync(join(VAULT, "notes")))
    return "이 폴더에 notes/ 가 없습니다: " + VAULT +
      "\n앱에서 \"폴더 고르기\"로 연결한 폴더를 지정해 주세요.";
  return null;
}

/* ── 볼트 읽기·쓰기 ────────────────────────────────────── */
const notesDir = () => join(VAULT, "notes");
const imagesDir = () => join(VAULT, "images");

function readJSON(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}
function readTags() {
  const d = readJSON(join(VAULT, "tags.json"), null);
  return d && Array.isArray(d.tags) ? d.tags : [];
}
function writeTags(tags) {
  const payload = { app: "gusuk", v: 1, updatedAt: Date.now(), tags };
  writeFileSync(join(VAULT, "tags.json"), JSON.stringify(payload, null, 1), "utf8");
}
function noteFiles() {
  try { return readdirSync(notesDir()).filter((f) => /\.json$/i.test(f)); } catch { return []; }
}
function readNotes() {
  const out = [];
  for (const f of noteFiles()) {
    const d = readJSON(join(notesDir(), f), null);
    if (d && d.id && f === d.id + ".json") out.push(d);
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function readNote(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) return null;
  return readJSON(join(notesDir(), id + ".json"), null);
}
function writeNote(note) {
  // 규칙 1: 앱이 변경을 알아채려면 updatedAt 이 반드시 커져야 한다
  note.updatedAt = Date.now();
  note.app = "gusuk";
  note.v = 1;
  writeFileSync(join(notesDir(), note.id + ".json"), JSON.stringify(note, null, 1), "utf8");
  return note;
}

/* 태그 이름을 tags.json 에 등록해 둔다 (카테고리를 지정하고 싶을 때) */
function registerTags(names, category) {
  if (!category || !CATS[category]) return;
  const tags = readTags();
  let touched = false;
  for (const n of names) {
    const i = tags.findIndex((t) => t.name === n);
    if (i < 0) { tags.push({ name: n, cat: category }); touched = true; }
    else if (tags[i].cat === "etc" && category !== "etc") { tags[i].cat = category; touched = true; }
  }
  if (touched) writeTags(tags);
}

/* ── 조회 도우미 ───────────────────────────────────────── */
function allTagNames(n) {
  return new Set([...(n.tags || []), ...(n.regions || []).flatMap((r) => r.tags || [])]);
}
function tagCatalog() {
  const declared = new Map(readTags().map((t) => [t.name, t.cat || "etc"]));
  const count = new Map();
  for (const n of readNotes())
    for (const t of allTagNames(n)) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()]
    .map(([name, n]) => ({ name, count: n, category: declared.get(name) || "etc" }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}
function brief(n) {
  return {
    id: n.id,
    title: n.title || "(제목 없음)",
    date: n.createdAt ? new Date(n.createdAt).toISOString().slice(0, 10) : null,
    space: n.space || null,
    tags: n.tags || [],
    note: n.note || "",
    memo_count: (n.regions || []).length,
    image: n.image && n.image.file ? n.image.file : null,
  };
}
function haystack(n) {
  return [
    n.title, n.note, ...(n.tags || []),
    ...(n.regions || []).flatMap((r) => [r.text, ...(r.tags || [])]),
  ].filter(Boolean).join("\n").toLowerCase();
}

/* ── 도구 정의 ─────────────────────────────────────────── */
const S = (props, required) => ({ type: "object", properties: props, required: required || [] });
const str = (description) => ({ type: "string", description });
const strs = (description) => ({ type: "array", items: { type: "string" }, description });

const TOOLS = [
  {
    name: "list_corners",
    description: "아카이브에 담긴 사진들을 목록으로 본다. 태그나 검색어로 좁힐 수 있다.",
    inputSchema: S({
      tags: strs("이 태그들로 거른다"),
      match: { type: "string", enum: ["any", "all"], description: "태그 조합 방식 (기본 any)" },
      query: str("제목·메모·태그에서 찾을 말"),
      limit: { type: "number", description: "최대 개수 (기본 50)" },
    }),
  },
  {
    name: "get_corner",
    description: "사진 한 장의 전체 내용을 본다 — 제목, 한 줄 인상, 태그, 부분 메모까지.",
    inputSchema: S({ id: str("사진 id") }, ["id"]),
  },
  {
    name: "search",
    description: "아카이브 전체에서 말로 찾는다. 부분 메모 안까지 뒤진다.",
    inputSchema: S({ query: str("찾을 말"), limit: { type: "number" } }, ["query"]),
  },
  {
    name: "list_tags",
    description: "쓰이고 있는 태그 전부를 카테고리·사용 횟수와 함께 본다.",
    inputSchema: S({}),
  },
  {
    name: "list_spaces",
    description: "공간(여러 장을 묶은 자리) 목록을 본다. 이름·메모와 객관 정보인 '사실'까지.",
    inputSchema: S({}),
  },
  {
    name: "set_space",
    description: "사진을 어느 공간에 넣는다. 없는 이름이면 새로 만든다. 빈 값이면 묶음에서 뺀다.",
    inputSchema: S({ id: str("사진 id"), space: str("공간 이름 (빈 문자열이면 해제)") }, ["id", "space"]),
  },
  {
    name: "stats",
    description: "아카이브 전체 요약 — 몇 장인지, 자주 쓰는 태그, 함께 등장하는 태그 짝.",
    inputSchema: S({}),
  },
  {
    name: "add_tags",
    description: "사진에 태그를 붙인다. 이미 있는 태그는 건너뛴다.",
    inputSchema: S({
      id: str("사진 id"),
      tags: strs("붙일 태그 이름들"),
      category: { type: "string", enum: Object.keys(CATS), description: "새 태그의 분류 (선택)" },
    }, ["id", "tags"]),
  },
  {
    name: "remove_tags",
    description: "사진에서 태그를 뗀다.",
    inputSchema: S({ id: str("사진 id"), tags: strs("뗄 태그 이름들") }, ["id", "tags"]),
  },
  {
    name: "set_note",
    description: "사진의 '한 줄 인상'을 쓴다. 기존 내용을 덮어쓴다.",
    inputSchema: S({ id: str("사진 id"), note: str("적을 내용") }, ["id", "note"]),
  },
  {
    name: "set_title",
    description: "사진의 제목을 바꾼다.",
    inputSchema: S({ id: str("사진 id"), title: str("새 제목") }, ["id", "title"]),
  },
  {
    name: "set_memo",
    description: "사진 안 '좋아하는 부분'에 달린 메모를 쓴다. 부분은 앱에서 먼저 표시해 두어야 한다.",
    inputSchema: S({
      id: str("사진 id"),
      region_id: str("부분 id (get_corner 로 확인)"),
      text: str("적을 내용"),
    }, ["id", "region_id", "text"]),
  },
  {
    name: "export_markdown",
    description: "아카이브를 마크다운으로 내보낸다. 옵시디언 볼트 폴더를 지정하면 그 안에서 바로 열린다.",
    inputSchema: S({
      out_dir: str("내보낼 폴더 (예: 옵시디언 볼트 안의 '좋아하는 구석')"),
      tags: strs("이 태그가 붙은 것만"),
      copy_images: { type: "boolean", description: "사진 파일도 함께 복사 (기본 true)" },
    }, ["out_dir"]),
  },
];

/* ── 도구 구현 ─────────────────────────────────────────── */
function filterNotes(a) {
  let list = readNotes();
  if (a.tags && a.tags.length) {
    const want = a.tags.map(String);
    list = list.filter((n) => {
      const have = allTagNames(n);
      return a.match === "all" ? want.every((t) => have.has(t)) : want.some((t) => have.has(t));
    });
  }
  if (a.query) {
    const q = String(a.query).toLowerCase();
    list = list.filter((n) => haystack(n).includes(q));
  }
  return list;
}
function mustRead(id) {
  const n = readNote(id);
  if (!n) throw new Error("그런 사진이 없습니다: " + id);
  return n;
}

const IMPL = {
  list_corners(a) {
    const list = filterNotes(a);
    const limit = a.limit || 50;
    return {
      total: list.length,
      showing: Math.min(limit, list.length),
      corners: list.slice(0, limit).map(brief),
    };
  },

  get_corner(a) {
    const n = mustRead(a.id);
    return {
      ...brief(n),
      links: n.links || [],
      memos: (n.regions || []).map((r) => ({
        region_id: r.id,
        text: r.text || "",
        tags: r.tags || [],
        area: { x: +r.x, y: +r.y, w: +r.w, h: +r.h }, // 사진 안 위치 (0~1 비율)
      })),
    };
  },

  search(a) {
    const q = String(a.query).toLowerCase();
    const hits = [];
    for (const n of readNotes()) {
      const where = [];
      if ((n.title || "").toLowerCase().includes(q)) where.push("제목");
      if ((n.note || "").toLowerCase().includes(q)) where.push("한 줄 인상");
      if ((n.tags || []).some((t) => t.toLowerCase().includes(q))) where.push("태그");
      const memos = (n.regions || []).filter((r) => (r.text || "").toLowerCase().includes(q));
      if (memos.length) where.push("부분 메모");
      if (!where.length) continue;
      hits.push({ ...brief(n), matched_in: where, matching_memos: memos.map((r) => r.text) });
    }
    return { total: hits.length, results: hits.slice(0, a.limit || 30) };
  },

  list_tags() {
    const all = tagCatalog();
    const grouped = {};
    for (const t of all) {
      const label = CATS[t.category] || CATS.etc;
      (grouped[label] = grouped[label] || []).push({ name: t.name, count: t.count });
    }
    return { total: all.length, by_category: grouped };
  },

  stats() {
    const notes = readNotes();
    const tags = tagCatalog();
    const pair = new Map();
    for (const n of notes) {
      const names = [...allTagNames(n)].sort();
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const k = names[i] + " + " + names[j];
          pair.set(k, (pair.get(k) || 0) + 1);
        }
    }
    return {
      photos: notes.length,
      memos: notes.reduce((s, n) => s + (n.regions || []).length, 0),
      tags: tags.length,
      spaces: new Set(notes.map((n) => n.space).filter(Boolean)).size,
      untagged: notes.filter((n) => allTagNames(n).size === 0).length,
      top_tags: tags.slice(0, 15),
      frequent_pairs: [...pair.entries()]
        .filter(([, c]) => c > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, c]) => ({ pair: k, count: c })),
      newest: notes[0] ? brief(notes[0]) : null,
    };
  },

  list_spaces() {
    const meta = readJSON(join(VAULT, "spaces.json"), null);
    const declared = new Map(
      ((meta && meta.spaces) || []).map((sp) => [sp.name, sp]));
    const count = new Map();
    for (const n of readNotes())
      if (n.space) count.set(n.space, (count.get(n.space) || 0) + 1);
    const names = new Set([...count.keys(), ...declared.keys()]);
    return {
      total: names.size,
      spaces: [...names].sort((a, b) => a.localeCompare(b, "ko")).map((name) => {
        const d = declared.get(name) || {};
        return {
          name,
          photos: count.get(name) || 0,
          note: d.note || "",
          facts: (d.facts || []).map((f) => ({ [f.k]: f.v })),
        };
      }),
    };
  },

  set_space(a) {
    const n = mustRead(a.id);
    const name = String(a.space || "").trim().replace(/\s+/g, " ");
    n.space = name || null;
    writeNote(n);
    return {
      id: n.id,
      space: n.space,
      note: name
        ? "앱이 20초 안에 반영합니다. 새 이름이면 공간이 새로 생깁니다."
        : "묶음에서 뺐습니다.",
    };
  },

  add_tags(a) {
    const n = mustRead(a.id);
    const names = a.tags.map((t) => String(t).trim().replace(/\s+/g, " ")).filter(Boolean);
    if (!names.length) throw new Error("붙일 태그가 없습니다.");
    const cur = n.tags || [];
    const added = names.filter((t) => !cur.includes(t));
    n.tags = cur.concat(added);
    writeNote(n);
    registerTags(added, a.category);
    return { id: n.id, added, tags_now: n.tags, note: "앱이 20초 안에 알아서 반영합니다." };
  },

  remove_tags(a) {
    const n = mustRead(a.id);
    const drop = new Set(a.tags.map(String));
    const before = (n.tags || []).length;
    n.tags = (n.tags || []).filter((t) => !drop.has(t));
    writeNote(n);
    return { id: n.id, removed: before - n.tags.length, tags_now: n.tags };
  },

  set_note(a) {
    const n = mustRead(a.id);
    n.note = String(a.note);
    writeNote(n);
    return { id: n.id, note: n.note };
  },

  set_title(a) {
    const n = mustRead(a.id);
    n.title = String(a.title);
    writeNote(n);
    return { id: n.id, title: n.title };
  },

  set_memo(a) {
    const n = mustRead(a.id);
    const r = (n.regions || []).find((x) => x.id === a.region_id);
    if (!r)
      throw new Error(
        "그런 부분이 없습니다: " + a.region_id +
        "\n있는 부분: " + ((n.regions || []).map((x) => x.id).join(", ") || "없음"));
    r.text = String(a.text);
    writeNote(n);
    return { id: n.id, region_id: r.id, text: r.text };
  },

  export_markdown(a) {
    const out = resolve(a.out_dir);
    mkdirSync(out, { recursive: true });
    const copyImages = a.copy_images !== false;
    const imgOut = join(out, "images");
    if (copyImages) mkdirSync(imgOut, { recursive: true });

    const list = filterNotes({ tags: a.tags, match: "any" });
    const written = [];
    for (const n of list) {
      const safe =
        (n.title || n.id).replace(/[\\/:*?"<>|#^[\]]/g, "").trim().slice(0, 60) || n.id;
      const file = safe + " (" + n.id + ").md";
      const date = n.createdAt ? new Date(n.createdAt).toISOString().slice(0, 10) : "";
      let img = null;
      if (n.image && n.image.file) {
        const src = join(imagesDir(), n.image.file);
        if (existsSync(src)) {
          if (copyImages) {
            try {
              copyFileSync(src, join(imgOut, n.image.file));
              img = "images/" + n.image.file;
            } catch { /* 사진 하나 못 옮겨도 노트는 남긴다 */ }
          } else img = src;
        }
      }
      const hash = (t) => "#" + String(t).replace(/\s+/g, "_");
      const lines = [
        "---",
        "title: " + JSON.stringify(n.title || ""),
        "date: " + date,
        "space: " + JSON.stringify(n.space || ""),
        "tags: [" + (n.tags || []).map((t) => JSON.stringify(t)).join(", ") + "]",
        "gusuk_id: " + n.id,
        "---",
        "",
        "# " + (n.title || "제목 없음"),
        "",
      ];
      if (img) lines.push("![[" + img + "]]", "");
      if (n.note) lines.push(n.note, "");
      const rs = (n.regions || []).filter((r) => (r.text || "") || (r.tags || []).length);
      if (rs.length) {
        lines.push("## 좋아하는 부분", "");
        rs.forEach((r, i) => {
          lines.push("**" + (i + 1) + ".** " + (r.text || "(메모 없음)"));
          if ((r.tags || []).length) lines.push("   " + r.tags.map(hash).join(" "));
          lines.push("");
        });
      }
      if ((n.tags || []).length) lines.push("", n.tags.map(hash).join(" "));
      writeFileSync(join(out, file), lines.join("\n"), "utf8");
      written.push(file);
    }
    return {
      out_dir: out,
      written: written.length,
      images_copied: copyImages,
      files: written.slice(0, 20),
    };
  },
};

/* ── JSON-RPC (stdio) ──────────────────────────────────── */
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return ok(id, {
      // 클라이언트가 요청한 버전을 그대로 받아준다 (버전별 기능을 쓰지 않으므로)
      protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER,
    });
  }
  if (method === "notifications/initialized" || isNotification) return;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const fn = IMPL[name];
    if (!fn) return fail(id, -32602, "그런 도구가 없습니다: " + name);
    const problem = vaultProblem();
    if (problem) return ok(id, { content: [{ type: "text", text: problem }], isError: true });
    try {
      const result = fn(args);
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: String((e && e.message) || e) }], isError: true });
    }
  }
  return fail(id, -32601, "모르는 method: " + method);
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    try { handle(msg); }
    catch (e) { if (msg && msg.id != null) fail(msg.id, -32603, String((e && e.message) || e)); }
  }
});
process.stdin.on("end", () => process.exit(0));

// 로그는 반드시 stderr 로. stdout 은 프로토콜 전용이다.
process.stderr.write("좋아하는 구석 MCP — 볼트: " + (VAULT || "(지정 안 됨)") + "\n");
