// rice:// file manager — components
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============= Titlebar =============
function Titlebar({ tabs, activeTab, onSelectTab, onCloseTab, onNewTab }) {
  return (
    <div className="titlebar">
      <div className="traffic">
        <span className="dot close" title="close"></span>
        <span className="dot minimize" title="minimize"></span>
        <span className="dot maximize" title="maximize"></span>
      </div>
      <div className="tabs">
        {tabs.map((t, i) => (
          <div
            key={i}
            className={"tab" + (i === activeTab ? " active" : "")}
            onClick={() => onSelectTab(i)}
          >
            <span className="ico" style={{color: t.color}}>{t.ic}</span>
            <span className="label">{t.label}</span>
            <span className="close" onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}></span>
          </div>
        ))}
        <div className="tab-actions">
          <button className="tab-btn" title="New tab" onClick={onNewTab}>+</button>
          <button className="tab-btn" title="Tab menu">⌄</button>
        </div>
      </div>
    </div>
  );
}

// ============= Menu bar + dropdown =============
function MenuItem({ item, onAction, onSubHover, subOpen }) {
  if (item.kind === "sep") return <div className="sep" />;
  if (item.kind === "grouplabel") return <div className="group-label">{item.label}</div>;
  const isSub = item.kind === "sub";
  return (
    <div
      className={"mi" + (item.danger ? " danger" : "") + (subOpen ? " hover" : "")}
      onMouseEnter={() => onSubHover && onSubHover(isSub ? item : null)}
      onClick={() => !isSub && onAction && onAction(item.label)}
    >
      <span className="ic">{item.check ? "✓" : item.ic || ""}</span>
      <span>{item.label}</span>
      <span className="kb">{item.kb || ""}</span>
      <span className="chev">{isSub ? "›" : ""}</span>
      {isSub && subOpen && (
        <div className="dropdown" style={{left: "calc(100% + 2px)", top: "-4px", minWidth: 240}}>
          {item.children.map((c, i) => (
            <MenuItem key={i} item={c} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function Menubar({ onOpenPalette }) {
  const [open, setOpen] = useState(null);
  const [subHover, setSubHover] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const close = (e) => {
      if (!ref.current?.contains(e.target)) { setOpen(null); setSubHover(null); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const keys = Object.keys(MENUS);
  return (
    <div className="menubar" ref={ref}>
      {keys.map(k => (
        <div
          key={k}
          className={"menubar-item" + (open === k ? " open" : "")}
          onClick={() => setOpen(open === k ? null : k)}
          onMouseEnter={() => open && setOpen(k)}
        >
          <span><span className="u">{k[0]}</span>{k.slice(1)}</span>
          {open === k && (
            <div className="dropdown" onClick={(e) => e.stopPropagation()}>
              {MENUS[k].map((it, i) => (
                <MenuItem
                  key={i}
                  item={it}
                  subOpen={subHover?.label === it.label}
                  onSubHover={(s) => setSubHover(s)}
                  onAction={() => setOpen(null)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-right">
        <span onClick={onOpenPalette} style={{cursor:"pointer"}}>
          <span className="kbd">Ctrl</span>&nbsp;<span className="kbd">P</span>&nbsp;palette
        </span>
        <span>· NORMAL mode</span>
        <span>· rice://v0.4.2-dev</span>
      </div>
    </div>
  );
}

// ============= Toolbar / breadcrumb =============
function Toolbar({ onSearchFocus }) {
  const parts = ["home", "void", "projects", "glasshouse"];
  return (
    <div className="toolbar">
      <div className="nav-btns">
        <button className="nav-btn" title="Back (Alt+←)">←</button>
        <button className="nav-btn" title="Forward (Alt+→)">→</button>
        <button className="nav-btn" title="Up (Alt+↑)">↑</button>
        <button className="nav-btn" title="Refresh (F5)">↻</button>
      </div>
      <div className="breadcrumb">
        <span className="scheme">rice://</span>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <span className={"crumb" + (i === parts.length - 1 ? " last" : "")}>{p}</span>
            {i < parts.length - 1 && <span className="sep">/</span>}
          </React.Fragment>
        ))}
        <span className="git-branch">⎇ main ↑2 ↓0 ●5</span>
      </div>
      <div className="search" onClick={onSearchFocus}>
        <span style={{color: "var(--fg-3)"}}>⌕</span>
        <input placeholder="find in current dir…  (fuzzy)" />
        <span className="kb">/</span>
      </div>
      <div className="tool-group">
        <button className="nav-btn" title="Toggle hidden (Ctrl+H)">·h</button>
        <button className="nav-btn" title="Details view">≡</button>
        <button className="nav-btn" title="Grid view">▦</button>
        <button className="nav-btn" title="Inspector">◨</button>
      </div>
    </div>
  );
}

// ============= Sidebar =============
function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sb-group">
        <div className="sb-title"><span>PINNED</span><span style={{color:"var(--fg-3)"}}>+</span></div>
        {SIDEBAR.pinned.map((p, i) => (
          <div key={i} className={"sb-item" + (p.active ? " active" : "")}>
            <span className="ic">{p.ic || "·"}</span>
            <span>{p.label}</span>
            <span className="badge">{p.badge}</span>
          </div>
        ))}
      </div>

      <div className="sb-group">
        <div className="sb-title"><span>TREE</span><span style={{color:"var(--fg-3)"}}>⋯</span></div>
        {TREE.map((n, i) => (
          <div key={i}
               className={"tree-row" + (n.active ? " active" : "")}
               style={{paddingLeft: 12 + n.depth * 10, opacity: n.dim ? 0.5 : 1}}>
            <span className="chev">{n.open ? "▾" : "▸"}</span>
            <span className="ic">{n.ic || ""}</span>
            <span>{n.name}</span>
            <span className={"git " + (n.git || "")}>{n.git === "mod" ? "●" : n.git === "add" ? "+" : ""}</span>
          </div>
        ))}
      </div>

      <div className="sb-group">
        <div className="sb-title">TAGS</div>
        {SIDEBAR.tags.map((t, i) => (
          <div key={i} className="sb-item">
            <span className="ic" style={{color: t.color}}>●</span>
            <span>{t.label}</span>
            <span className="badge">{t.count}</span>
          </div>
        ))}
      </div>

      <div className="sb-group">
        <div className="sb-title">DEVICES</div>
        {SIDEBAR.devices.map((d, i) => (
          <div key={i} className="sb-item" style={{gridTemplateColumns: "16px 1fr"}}>
            <span className="ic">{d.ic || "·"}</span>
            <div>
              <div>{d.label}</div>
              <div style={{color:"var(--fg-3)", fontSize:10}}>{d.meta}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="sb-group">
        <div className="sb-title">REMOTE</div>
        {SIDEBAR.remote.map((d, i) => (
          <div key={i} className="sb-item" style={{gridTemplateColumns: "16px 1fr"}}>
            <span className="ic">{d.ic || "·"}</span>
            <div>
              <div>{d.label}</div>
              <div style={{color:"var(--fg-3)", fontSize:10}}>{d.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ============= Main file pane =============
function kindIcon(kind) {
  switch (kind) {
    case "folder": return { ic: "▸", cls: "folder" };
    case "code":   return { ic: "<>", cls: "code" };
    case "img":    return { ic: "▢", cls: "img" };
    case "archive":return { ic: "◫", cls: "archive" };
    case "exec":   return { ic: "$", cls: "exec" };
    default:       return { ic: "≡", cls: "text" };
  }
}

function tagColor(tag) {
  const m = { project: "var(--magenta)", school: "var(--green)", secret: "var(--red)", review: "var(--yellow)", archive: "var(--cyan)" };
  return m[tag] || "var(--fg-3)";
}

function FilePane({ selected, setSelected, onContext, showHidden }) {
  const files = showHidden ? FILES : FILES.filter(f => !f.hidden);

  const handleRowClick = (i, e) => {
    if (e.shiftKey && selected.length) {
      const last = selected[selected.length - 1];
      const a = Math.min(last, i), b = Math.max(last, i);
      setSelected(Array.from({length: b-a+1}, (_, k) => a+k));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected(selected.includes(i) ? selected.filter(x => x !== i) : [...selected, i]);
    } else {
      setSelected([i]);
    }
  };

  return (
    <section className="pane" onContextMenu={(e) => { e.preventDefault(); onContext(e, selected.length ? "file" : "empty"); }}>
      <div className="pane-head">
        <div className="col"></div>
        <div className="col">name <span className="sort">↑</span></div>
        <div className="col">tag</div>
        <div className="col" style={{justifyContent:"flex-end"}}>size</div>
        <div className="col">modified</div>
        <div className="col" style={{justifyContent:"flex-end"}}>git</div>
      </div>
      <div className="rows">
        {files.map((f, i) => {
          const ki = kindIcon(f.kind);
          const isSel = selected.includes(i);
          return (
            <div key={i}
                 className={"row" + (isSel ? " selected" : "")}
                 style={{opacity: f.dimmed ? 0.55 : 1}}
                 onClick={(e) => handleRowClick(i, e)}
                 onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!isSel) setSelected([i]); onContext(e, "file"); }}>
              <span className={"ic " + ki.cls}>{ki.ic}</span>
              <span className="name">
                {f.git && <span className={"git-dot " + f.git}></span>}
                <span style={{color: f.hidden ? "var(--fg-3)" : "inherit"}}>{f.name}</span>
                {f.ext && !f.hidden && f.kind !== "folder" && <span className="ext">.{f.ext}</span>}
              </span>
              <span className="tag">
                {f.tag ? <><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</> : <span style={{color:"var(--fg-3)"}}>—</span>}
              </span>
              <span className="size">{f.size}</span>
              <span className="date">{f.date}</span>
              <span className="tag" style={{textAlign:"right"}}>
                {f.git === "mod" ? <span style={{color:"var(--yellow)"}}>M</span>
                 : f.git === "add" ? <span style={{color:"var(--green)"}}>A</span>
                 : f.git === "del" ? <span style={{color:"var(--red)"}}>D</span>
                 : f.git === "untracked" ? <span style={{color:"var(--fg-3)"}}>??</span>
                 : <span style={{color:"var(--fg-3)"}}>·</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============= Inspector =============
function Inspector({ file }) {
  const f = file || FILES.find(x => x.name === "main.rs");
  const isImg = f.kind === "img";

  return (
    <aside className="inspector">
      <div className="insp-hero">
        <div className="insp-preview">
          {isImg ? (
            <div className="ghost">preview · {f.ext.toUpperCase()} · 1920×1080</div>
          ) : f.kind === "code" ? (
            <div style={{fontSize: 10, color:"var(--fg-2)", textAlign:"left", padding:10, alignSelf:"stretch"}}>
              <div><span style={{color:"var(--red)"}}>fn</span> <span style={{color:"var(--blue)"}}>main</span>() {"{"}</div>
              <div>&nbsp;&nbsp;<span style={{color:"var(--magenta)"}}>println!</span>(<span style={{color:"var(--green)"}}>"hello, rice"</span>);</div>
              <div>{"}"}</div>
              <div style={{color:"var(--fg-3)", marginTop:6}}>…+ 247 lines</div>
            </div>
          ) : (
            <div className="big-ic">{kindIcon(f.kind).ic}</div>
          )}
        </div>
        <div className="insp-title">{f.name}</div>
        <div className="insp-path">~/projects/glasshouse/{f.name}</div>
        <div>
          {f.tag && <span className="chip"><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</span>}
          <span className="chip">{f.kind}</span>
          {f.git && <span className="chip" style={{color: f.git === "mod" ? "var(--yellow)" : f.git === "add" ? "var(--green)" : "var(--fg-2)"}}>
            git: {f.git}
          </span>}
        </div>
      </div>

      <div className="insp-section">
        <h4>METADATA</h4>
        <dl className="kv">
          <dt>size</dt><dd>{f.size}</dd>
          <dt>modified</dt><dd>{f.date}</dd>
          <dt>created</dt><dd>2026-03-14 09:22:18</dd>
          <dt>owner</dt><dd>void:void</dd>
          <dt>inode</dt><dd>2359297</dd>
          <dt>mime</dt><dd className="mono">{f.kind === "code" ? "text/x-rust" : f.kind === "img" ? "image/png" : "text/plain"}</dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>PERMISSIONS <span style={{color:"var(--accent)", cursor:"pointer"}}>edit</span></h4>
        <div style={{fontFamily:"var(--font-mono)", color:"var(--fg-0)", marginBottom:6}}>
          <span style={{color:"var(--accent)"}}>-</span>
          <span style={{color:"var(--green)"}}>rw-</span>
          <span style={{color:"var(--yellow)"}}>r--</span>
          <span style={{color:"var(--red)"}}>r--</span>
          <span style={{color:"var(--fg-3)"}}>  0644</span>
        </div>
        <div className="perm-grid">
          <div></div><div className="h">owner</div><div className="h">group</div><div className="h">world</div>
          <div className="h" style={{textAlign:"right"}}>read</div>
          <div className="perm-cell">r</div><div className="perm-cell">r</div><div className="perm-cell">r</div>
          <div className="h" style={{textAlign:"right"}}>write</div>
          <div className="perm-cell">w</div><div className="perm-cell off">—</div><div className="perm-cell off">—</div>
          <div className="h" style={{textAlign:"right"}}>exec</div>
          <div className="perm-cell off">—</div><div className="perm-cell off">—</div><div className="perm-cell off">—</div>
        </div>
      </div>

      <div className="insp-section">
        <h4>CHECKSUMS <span style={{color:"var(--accent)", cursor:"pointer"}}>copy</span></h4>
        <dl className="kv">
          <dt>sha256</dt><dd className="mono" style={{fontSize:10}}>9f2a8c1e…b47f3d02</dd>
          <dt>md5</dt><dd className="mono" style={{fontSize:10}}>1cda4f…8b3a</dd>
          <dt>crc32</dt><dd className="mono">0x7a3e1fcc</dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>GIT <span style={{color:"var(--orange)"}}>⎇ main</span></h4>
        <dl className="kv">
          <dt>last commit</dt><dd>3 hours ago</dd>
          <dt>author</dt><dd>void</dd>
          <dt>sha</dt><dd className="mono">a3f81c2</dd>
          <dt>diff</dt><dd><span style={{color:"var(--green)"}}>+42</span> / <span style={{color:"var(--red)"}}>−7</span></dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>QUICK ACTIONS</h4>
        <div style={{display:"flex", flexWrap:"wrap", gap:4}}>
          <span className="chip" style={{cursor:"pointer"}}>▶ run</span>
          <span className="chip" style={{cursor:"pointer"}}>⌨ open in code</span>
          <span className="chip" style={{cursor:"pointer"}}>⎇ git blame</span>
          <span className="chip" style={{cursor:"pointer"}}>⌘ copy path</span>
          <span className="chip" style={{cursor:"pointer"}}>◫ compress</span>
          <span className="chip" style={{cursor:"pointer"}}># hash</span>
        </div>
      </div>
    </aside>
  );
}

// ============= Status bar =============
function StatusBar({ selectedCount, totalSize, onToggleTerm }) {
  return (
    <div className="statusbar">
      <div className="sb-seg mode">NORMAL</div>
      <div className="sb-seg"><span className="lbl">▸</span><span className="val">rice://home/void/projects/glasshouse</span></div>
      <div className="sb-seg accent"><span className="lbl">⎇</span><span className="val">main</span><span style={{color:"var(--fg-3)"}}>↑2</span></div>
      <div className="sb-seg"><span className="lbl">sel</span><span className="val">{selectedCount}</span><span style={{color:"var(--fg-3)"}}>/ 20</span></div>
      <div className="sb-seg"><span className="lbl">Σ</span><span className="val">{totalSize}</span></div>
      <div className="spacer"></div>
      <div className="sb-seg"><span className="lbl">fs</span><span className="val">ext4</span></div>
      <div className="sb-seg warn"><span className="lbl">/</span><span className="val">51%</span></div>
      <div className="sb-seg ok"><span className="lbl">cpu</span><span className="val">04%</span></div>
      <div className="sb-seg"><span className="lbl">mem</span><span className="val">6.2G</span></div>
      <div className="sb-seg"><span className="lbl">i/o</span><span className="val">▁▂▃▅▂▁</span></div>
      <div className="sb-seg"><span className="lbl">net</span><span className="val">↓82K ↑12K</span></div>
      <div className="sb-seg" style={{cursor:"pointer"}} onClick={onToggleTerm}><span className="val" style={{color:"var(--accent)"}}>⌨ term</span></div>
      <div className="sb-seg"><span className="lbl">up</span><span className="val">04:13:22</span></div>
      <div className="sb-seg"><span className="val">22:41:07</span></div>
    </div>
  );
}

// ============= Terminal drawer =============
function TerminalDrawer({ open, onClose }) {
  return (
    <div className={"term-drawer" + (open ? " open" : "")}>
      <div className="term-head">
        <div className="ttab active"><span style={{color:"var(--green)"}}>✓</span> zsh · glasshouse <span className="close">×</span></div>
        <div className="ttab">ssh · void@server</div>
        <div className="ttab">wsl · Ubuntu</div>
        <div className="ttab" style={{color:"var(--fg-3)"}}>+</div>
        <div className="right">
          <span title="split H">⊟</span>
          <span title="split V">⊟</span>
          <span title="zoom">⤢</span>
          <span title="close" onClick={onClose}>×</span>
        </div>
      </div>
      <div className="term-body">
        <div className="line"><span className="prompt">void@arch</span> <span className="dim">in</span> <span className="path">~/projects/glasshouse</span> <span className="dim">on</span> <span className="branch">⎇ main</span> <span className="dim">[●5]</span></div>
        <div className="line"><span className="prompt">❯</span> <span className="cmd">cargo build --release</span></div>
        <div className="line dim">   Compiling glasshouse v0.4.2 (/home/void/projects/glasshouse)</div>
        <div className="line dim">   Compiling tokio v1.37.0</div>
        <div className="line ok">    Finished `release` profile [optimized] target(s) in 12.4s</div>
        <div className="line"><span className="prompt">void@arch</span> <span className="dim">in</span> <span className="path">~/projects/glasshouse</span></div>
        <div className="line"><span className="prompt">❯</span> <span className="cmd">git status --short</span></div>
        <div className="line"><span style={{color:"var(--yellow)"}}> M</span> src/main.rs</div>
        <div className="line"><span style={{color:"var(--yellow)"}}> M</span> README.md</div>
        <div className="line"><span style={{color:"var(--green)"}}>A </span> src/palette.rs</div>
        <div className="line"><span className="dim">??</span> Screenshot_2026-04-22_10-14-03.png</div>
        <div className="line"><span className="prompt">❯</span> <span className="cursor"></span></div>
      </div>
    </div>
  );
}

// ============= Command palette =============
function Palette({ onClose }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef();
  const items = useMemo(() => {
    if (!q) return PALETTE;
    return PALETTE.filter(p => p.label.toLowerCase().includes(q.toLowerCase()));
  }, [q]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIdx(0); }, [q]);

  const onKey = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((idx + 1) % items.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((idx - 1 + items.length) % items.length); }
    if (e.key === "Enter") onClose();
  };

  const groups = {};
  items.forEach((p, i) => { (groups[p.g] = groups[p.g] || []).push({ ...p, _i: i }); });

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-head">
          <span className="prefix">❯</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="type a command, path, or :mode" />
          <span className="hint">{items.length} results · <span className="kbd">↑↓</span> navigate</span>
        </div>
        <div className="palette-body">
          {Object.entries(groups).map(([g, arr]) => (
            <div key={g}>
              <div className="pal-group">{g}</div>
              {arr.map((p) => (
                <div key={p._i} className={"pal-row" + (p._i === idx ? " active" : "")} onMouseEnter={() => setIdx(p._i)}>
                  <span className="ic">{p.ic}</span>
                  <span>{p.label}</span>
                  <span className="kb">{(p.kb || []).map((k, i) => <span key={i}>{k}</span>)}</span>
                </div>
              ))}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{padding: 20, textAlign: "center", color:"var(--fg-3)"}}>no matches. try <code>:help</code></div>
          )}
        </div>
        <div className="palette-foot">
          <span><span className="kb">↵</span>run</span>
          <span><span className="kb">Tab</span>autocomplete</span>
          <span><span className="kb">Ctrl</span><span className="kb">`</span>run in terminal</span>
          <span><span className="kb">Esc</span>close</span>
          <span style={{marginLeft:"auto"}}>:<i>go</i> · /<i>find</i> · ?<i>help</i> · !<i>shell</i></span>
        </div>
      </div>
    </div>
  );
}

// ============= Context menu =============
function ContextMenu({ items, x, y, onClose }) {
  const [subHover, setSubHover] = useState(null);
  useEffect(() => {
    const h = () => onClose();
    setTimeout(() => document.addEventListener("mousedown", h, { once: true }), 0);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div className="ctx-menu" style={{left: x, top: y}} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <MenuItem key={i} item={it}
          subOpen={subHover?.label === it.label}
          onSubHover={(s) => setSubHover(s)}
          onAction={() => onClose()}
        />
      ))}
    </div>
  );
}

// ============= Tweaks panel =============
function Tweaks({ state, setState, onClose }) {
  const themes = [
    "tokyo-night", "catppuccin-mocha", "gruvbox-dark", "rose-pine",
    "everforest", "solarized-dark", "green-crt", "synthwave",
  ];
  const fonts = [
    '"JetBrains Mono", ui-monospace, monospace',
    '"Iosevka", ui-monospace, monospace',
    '"IBM Plex Mono", ui-monospace, monospace',
    '"Fira Code", ui-monospace, monospace',
    '"Berkeley Mono", ui-monospace, monospace',
  ];
  const fontLabels = ["JetBrains Mono", "Iosevka", "IBM Plex Mono", "Fira Code", "Berkeley Mono"];

  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span>◉</span>
        <span>tweaks · ~/.ricerc</span>
        <span className="close" onClick={onClose}>×</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak">
          <label>theme</label>
          <select value={state.theme} onChange={(e) => setState({...state, theme: e.target.value})}>
            {themes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="tweak">
          <label>font family</label>
          <select value={state.font} onChange={(e) => setState({...state, font: e.target.value})}>
            {fonts.map((f, i) => <option key={f} value={f}>{fontLabels[i]}</option>)}
          </select>
        </div>
        <div className="tweak">
          <label>density</label>
          <div className="segmented">
            {["compact","default","comfy"].map(d => (
              <button key={d} className={state.density === d ? "active" : ""} onClick={() => setState({...state, density: d})}>{d}</button>
            ))}
          </div>
        </div>
        <div className="tweak">
          <label>scanlines (CRT)</label>
          <div className="segmented">
            <button className={state.scanlines ? "" : "active"} onClick={() => setState({...state, scanlines: false})}>off</button>
            <button className={state.scanlines ? "active" : ""} onClick={() => setState({...state, scanlines: true})}>on</button>
          </div>
        </div>
        <div className="tweak">
          <label>hidden files</label>
          <div className="segmented">
            <button className={state.hidden ? "" : "active"} onClick={() => setState({...state, hidden: false})}>hide</button>
            <button className={state.hidden ? "active" : ""} onClick={() => setState({...state, hidden: true})}>show</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  Titlebar, Menubar, Toolbar, Sidebar, FilePane, Inspector,
  StatusBar, TerminalDrawer, Palette, ContextMenu, Tweaks,
});
