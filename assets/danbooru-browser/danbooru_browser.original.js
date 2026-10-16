import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";

// 模块级变量，跟踪事件监听器引用，避免 onNodeCreated 重复添加
let _clickHandlerInstalled = false;
let _pageKeyHandlerInstalled = false;
// 全局翻译缓存（跨节点共享，避免作用域问题）
const _globalTagTranslations = {};
const _globalTagCache = {};
const _globalTranslationCache = {};
// 收藏用上次打开帖子的缩略图 URL
let _lastThumbUrl = '';
// 收藏缓存（模块级 = 所有节点共享，解决跨节点同步问题）
let _favCache = null;

// ── 页面加载时把语言设置同步到后端 ──
(async () => {
    try {
        const lang = window.ComfyUI?.settings?.get?.('language')
            || window.app?.settings?.get?.('language')
            || navigator.language || 'en-US';
        await fetch('/danbooru_anima/set_language', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: lang })
        });
    } catch { /* 静默失败，后端会走 fallback */ }
})();

app.registerExtension({
    name: "Comfy.DanbooruAnimaBrowser",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "DanbooruBrowser") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([800, 1500]);
            this.isChanged = true;

            const node = this;
            // ── 节点名称本地化 ──
            try {
                const _nodeTitles = { 'en-US': 'Danbooru Browser', 'zh-CN': 'D站浏览器 (Danbooru Browser)', 'ja-JP': 'Danbooru ブラウザ (Danbooru Browser)', 'ko-KR': 'Danbooru 브라우저 (Danbooru Browser)' };
                let _nlang = (window.ComfyUI?.settings?.get?.('language')
                    || window.app?.settings?.get?.('language')
                    || navigator.language || 'en-US').replace(/_/g, '-');
                const _nlangMap = { 'zh': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR' };
                _nlang = _nlangMap[_nlang.toLowerCase()] || (_nodeTitles[_nlang] ? _nlang : 'en-US');
                this.title = _nodeTitles[_nlang] || 'Danbooru Browser';
            } catch {}
            // ── 端口名本地化 ──
            try {
                const _portNames = {
                    'en-US': ['image', 'All Tags', 'Quality/Meta Tags', 'Count Tags', 'Character Tags', 'Series Tags', 'Artist Tags', 'General Tags'],
                    'zh-CN': ['image', '全部标签', '质量/元标签', '数量标签', '角色标签', '系列标签', '画师标签', '常规标签'],
                    'ja-JP': ['image', 'すべてのタグ', '品質/メタタグ', '数量タグ', 'キャラタグ', 'シリーズタグ', 'アーティストタグ', '一般タグ'],
                    'ko-KR': ['image', '모든 태그', '품질/메타 태그', '수량 태그', '캐릭터 태그', '시리즈 태그', '아티스트 태그', '일반 태그'],
                };
                let _ulang2 = (window.ComfyUI?.settings?.get?.('language')
                    || window.app?.settings?.get?.('language')
                    || navigator.language || 'en-US').replace(/_/g, '-');
                const _langMap = { 'zh': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR' };
                _ulang2 = _langMap[_ulang2.toLowerCase()] || (_portNames[_ulang2] ? _ulang2 : 'en-US');
                const pn = _portNames[_ulang2] || _portNames['en-US'] || node.outputs?.map(o => o.name);
                if (pn && node.outputs) {
                    node.outputs.forEach((o, i) => { if (pn[i]) o.name = pn[i]; });
                }
            } catch {}
            let currentPage = 1;
            let currentPosts = [];
            let selectedPostId = null;
            let isLoading = false;
            let _preloadQueue = null;
            let acCache = {};       // 前端缓存 query → tags[]
            let tagCache = {};      // 预加载的标签 {post_id: classified}
            let _multiEnabled = false;
            let _multiSelections = new Set();
            let _multiMerge = { all: true, quality_meta: true, count: true, character: true, series: true, artist: true, general: true };
            let _tagFusionEnabled = false;
            let _fusionActiveSlot = 1;
            let _fusionSlots = { 1: new Set(), 2: new Set(), 3: new Set() };
            let _sync12 = false;

            // ── 隐藏内部 widget（端口也隐藏） ──
            const selWidget = node.widgets?.find(w => w.name === "selection_data");
            if (selWidget) { selWidget.computeSize = () => [0, 0]; selWidget.serialize = true; try { selWidget.hidden = true; } catch(e){} }
            const ratingWidget = node.widgets?.find(w => w.name === "rating_filter");
            if (ratingWidget) { ratingWidget.computeSize = () => [0, 0]; ratingWidget.serialize = true; try { ratingWidget.hidden = true; } catch(e){} }
            const nodeSettingsWidget = node.widgets?.find(w => w.name === "node_settings");
            if (nodeSettingsWidget) { nodeSettingsWidget.computeSize = () => [0, 0]; nodeSettingsWidget.serialize = true; try { nodeSettingsWidget.hidden = true; } catch(e){} }
            // 来自AnimaDex 端口→可见，方便连线
            const adQWidget = node.widgets?.find(w => w.name === "来自AnimaDex");
            if (adQWidget) { adQWidget.computeSize = () => [0.1, 20]; adQWidget.serialize = true; }
            // _tag_fusion widget（隐藏，分序号数据）
            const fusionWidget = node.widgets?.find(w => w.name === "_tag_fusion");
            if (fusionWidget) { fusionWidget.computeSize = () => [0, 0]; fusionWidget.serialize = true; try { fusionWidget.hidden = true; } catch(e){} }

            // ── 来自AnimaDex 监听 ──
            let _prevAdQ = "";
            setInterval(() => {
                if (!adQWidget || !searchInput) return;
                const q = (adQWidget.value || "").trim();
                if (q && q !== _prevAdQ) {
                    _prevAdQ = q;
                    searchInput.value = q;
                    if (typeof doSearch === "function") doSearch(1, q);
                    adQWidget.value = "";
                }
            }, 500);

            // ── 评级过滤持久化 ──
            const saveRatingState = () => {
                if (!ratingWidget) return;
                const state = JSON.stringify({ all: _ratAll.checked, ratings: [..._activeRatings] });
                ratingWidget.value = state;
                node.isChanged = true;
            };
            const loadRatingState = () => {
                if (!ratingWidget) return;
                try {
                    const state = JSON.parse(ratingWidget.value || "{}");
                    if (state.all !== undefined) _ratAll.checked = state.all;
                    allCb.checked = _ratAll.checked;
                    if (state.ratings) {
                        _activeRatings.clear();
                        for (const val of state.ratings) _activeRatings.add(val);
                        for (const cb of ratingCbs) cb.checked = false;
                        for (const val of state.ratings) {
                            const idx = ["general", "sensitive", "questionable", "explicit"].indexOf(val);
                            if (idx >= 0) ratingCbs[idx].checked = true;
                        }
                    }
                } catch {}
            };

            // ── 节点独立设置持久化（多选、原图输出等） ──
            const saveNodeSettings = () => {
                if (!nodeSettingsWidget) return;
                const state = {
                    multi_select_enabled: _multiEnabled,
                    multi_merge_all: _multiMerge.all,
                    multi_merge_quality_meta: _multiMerge.quality_meta,
                    multi_merge_count: _multiMerge.count,
                    multi_merge_character: _multiMerge.character,
                    multi_merge_series: _multiMerge.series,
                    multi_merge_artist: _multiMerge.artist,
                    multi_merge_general: _multiMerge.general,
                    original_resolution: _origResCheck ? _origResCheck.checked : true,
                    tag_fusion_enabled: _tagFusionEnabled || false,
                };
                nodeSettingsWidget.value = JSON.stringify(state);
                node.isChanged = true;
            };
            const loadNodeSettings = () => {
                if (!nodeSettingsWidget) return;
                try {
                    const s = JSON.parse(nodeSettingsWidget.value || "{}");
                    if (s.multi_select_enabled !== undefined) {
                        _multiEnabled = s.multi_select_enabled;
                        toggleMultiCbs(_multiEnabled);
                    }
                    _tagFusionEnabled = s.tag_fusion_enabled ?? false;
                    for (const k of Object.keys(_multiMerge)) {
                        const key = "multi_merge_" + k;
                        if (s[key] !== undefined) _multiMerge[k] = s[key];
                    }
                    if (s.original_resolution !== undefined && _origResCheck) {
                        _origResCheck.checked = s.original_resolution;
                    }
                } catch {}
            };

            // ── DOM Widget 容器 ──
            const container = $el("div.danbooru-anima-browser", {
                style: {
                    width: "100%", height: "100%", overflow: "hidden",
                    position: "relative",
                    display: "flex", flexDirection: "column",
                    background: "#1a1a2e", borderRadius: "4px",
                    fontSize: "13px",
                }
            });

            // ═══════════ 搜索栏 ═══════════
            const searchBar = $el("div", {
                style: { position: "relative", display: "flex", padding: "6px", gap: "4px", background: "#16213e", borderBottom: "1px solid #0f3460", flexWrap: "wrap" }
            });
            const searchInput = $el("input", {
                type: "text", placeholder: "输入文字后按回车键即可模糊搜索",
                style: { flex: "1 1 160px", padding: "12px 16px", borderRadius: "6px", border: "1px solid #0f3460", background: "#1a1a2e", color: "#e0e0e0", fontSize: "20px", outline: "none", minWidth: "100px" }
            });
            const searchBtn = $el("button", {
                textContent: "🔍", title: "搜索",
                style: { padding: "10px 18px", borderRadius: "6px", border: "none", background: "#e94560", color: "#fff", cursor: "pointer", fontSize: "20px" }
            });
            let _hotActive = false;
            const _HOT_STYLE = { border: "2px solid #ff9800", boxShadow: "0 0 12px #ff980066" };
            const _DEF_STYLE = { border: "none", boxShadow: "none" };
            const hotBtn = $el("button", {
                textContent: "🔥", title: "热门",
                style: { padding: "10px 18px", borderRadius: "6px", border: "none", background: "transparent", color: "#ff9800", cursor: "pointer", fontSize: "20px" }
            });
            hotBtn.onclick = () => {
                _hotActive = !_hotActive;
                Object.assign(hotBtn.style, _hotActive ? _HOT_STYLE : _DEF_STYLE);
                searchInput.value = "";
                doSearch(1, _hotActive ? "order:rank" : "");
            };

            // ── 🧠 语义搜索切换 ──
            let _semanticActive = false;
            const _SEM_STYLE = { border: "2px solid #7c4dff", boxShadow: "0 0 12px #7c4dff66" };
            const _SEM_DEF_STYLE = { border: "none", boxShadow: "none" };
            const semBtn = $el("button", {
                textContent: "🧠", title: "语义搜索（BGE-M3）",
                style: { padding: "10px 18px", borderRadius: "6px", border: "none", background: "transparent", color: "#b388ff", cursor: "pointer", fontSize: "20px" }
            });
            let _vecReady = false;
            let _vecInitPromise = null;
            const _ensureVecReady = async () => {
                if (_vecReady) return true;
                const stR = await fetch("/danbooru_anima/vec_status");
                const stD = await stR.json();
                if (stD.ready) { _vecReady = true; return true; }
                if (stD.error) return false;
                const ok = await _showInitDialog("语义搜索需要 BGE-M3 模型\n首次初始化约需 2-3 分钟，是否开始？\n\n模型下载：\n🤗 HuggingFace: https://huggingface.co/BAAI/BGE-M3\n🇨🇳 国内: https://pan.quark.cn/s/e501b783f10f\n\n缓存下载也是同一网盘地址");
                if (!ok) return false;
                await fetch("/danbooru_anima/vec_init", {method:"POST"});
                _vecInitPromise = new Promise(resolve => {
                    const poll = setInterval(async () => {
                        const pR = await fetch("/danbooru_anima/vec_status");
                        const pD = await pR.json();
                        if (pD.ready) { clearInterval(poll); _vecReady = true; resolve(true); }
                        if (pD.error) { clearInterval(poll); resolve(false); }
                    }, 1500);
                });
                return await _vecInitPromise;
            };
            semBtn.onclick = async () => {
                if (!_semanticActive) {
                    // 首次开启语义搜索 → 检查引擎
                    const ready = await _ensureVecReady();
                    if (!ready) return; // 用户取消或失败，不开启
                }
                _semanticActive = !_semanticActive;
                Object.assign(semBtn.style, _semanticActive ? _SEM_STYLE : _SEM_DEF_STYLE);
                searchInput.placeholder = _semanticActive ? "🔮 输入中文/英文，语义匹配标签..." : "输入文字后按回车键即可模糊搜索";
                if (!_semanticActive) { acList.style.display = "none"; }
            };

            // ── ⭐ 收藏夹 ──
            const _getFavs = async (force = false) => {
                if (!force && _favCache) return _favCache;
                const r = await fetch('/danbooru_anima/favorites');
                const d = await r.json();
                _favCache = d.favorites || { artists: {}, characters: {}, series: {}, general: {} };
                // _order 保持（供排序使用）
                return _favCache;
            };
            const _toggleFav = async (tag, cat, thumbUrl, cn) => {
                if (!_favCache) await _getFavs();
                if (_favCache[cat]?.[tag]) {
                    await fetch('/danbooru_anima/favorites/remove', {
                        method: 'POST', headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ tag, category: cat })
                    });
                    delete _favCache[cat][tag];
                    return 'removed';
                } else {
                    const addR = await fetch('/danbooru_anima/favorites/add', {
                        method: 'POST', headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ tag, category: cat, thumb_url: thumbUrl || '', cn: cn || '' })
                    });
                    const addD = await addR.json();
                    if (!addD.success) { console.warn('[Fav] add failed', addD); return 'error'; }
                    if (!_favCache[cat]) _favCache[cat] = { _order: [] };
                    _favCache[cat][tag] = { thumb: thumbUrl || '', cn: cn || '' };
                    if (_favCache[cat]._order) {
                        _favCache[cat]._order.push(tag);
                        console.log('[Fav] pushed to order', {cat, tag, orderLen: _favCache[cat]._order.length});
                    } else {
                        _favCache[cat]._order = [tag];
                        console.log('[Fav] created order', {cat, tag});
                    }
                    return 'added';
                }
            };
            // 预加载收藏列表，让 ❤️/★ 按钮初始状态正确
            _getFavs();
            const openFavPopup = async () => {
                try {
                let favs = await _getFavs();
                const overlay = $el('div', { style: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 } });
                const dialog = $el('div', { style: { background: '#1a1a2e', borderRadius: '8px', padding: '32px', width: '1000px', maxWidth: '1000px', height: '640px', maxHeight: '85vh', border: '1px solid #0f3460', boxShadow: '0 6px 30px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' } });
                const titleRow = $el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } });
                const title = $el('div', { textContent: '⭐ 收藏夹', style: { fontSize: '22px', fontWeight: 'bold', color: '#e0e0e0' } });
                const closeBtn = $el('span', { textContent: '✕', style: { cursor: 'pointer', color: '#888', fontSize: '24px' }, onclick: () => overlay.remove() });
                // 导出/导入收藏
                const makeIoBtn = (txt, title, color, onClick) => {
                    const b = $el('button', { textContent: txt, title, style: { padding: '4px 10px', borderRadius: '4px', border: '1px solid ' + color, background: 'transparent', color, cursor: 'pointer', fontSize: '12px', marginRight: '6px' }, onclick: onClick });
                    return b;
                };
                const exportBtn = makeIoBtn('📤 导出', '导出收藏为 JSON 文件', '#4fc3f7', () => {
                    window.open('/danbooru_anima/favorites/export', '_blank');
                });
                const importBtn = makeIoBtn('📥 导入', '从 JSON 文件导入收藏', '#6bcb77', () => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = '.json';
                    inp.onchange = async (ev) => {
                        const file = ev.target.files?.[0];
                        if (!file) return;
                        try {
                            const text = await file.text();
                            const data = JSON.parse(text);
                            // 自定义弹窗
                            const mask = $el('div', { style: { position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:99999 } });
                            const box = $el('div', { style: { background:'#1a1a2e', borderRadius:'8px', padding:'24px', width:'380px', border:'1px solid #0f3460', textAlign:'center' } });
                            box.innerHTML = '<div style="font-size:16px;font-weight:bold;color:#e0e0e0;margin-bottom:12px;">📥 导入收藏</div>'
                                + '<div style="font-size:13px;color:#888;margin-bottom:16px;">选择导入方式：</div>'
                                + '<div style="display:flex;gap:8px;justify-content:center;">'
                                + '<button id="db-imp-merge" style="flex:1;padding:8px 0;border:none;border-radius:4px;background:#0f3460;color:#4fc3f7;cursor:pointer;font-size:13px;font-weight:bold;">不覆盖</button>'
                                + '<button id="db-imp-over" style="flex:1;padding:8px 0;border:none;border-radius:4px;background:#3a1a1a;color:#e94560;cursor:pointer;font-size:13px;font-weight:bold;">覆盖（清空文件夹）</button>'
                                + '</div>';
                            const doImp = async (mode) => {
                                mask.remove();
                                const r = await fetch('/danbooru_anima/favorites/import', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ favorites: data, mode })
                                });
                                const d = await r.json();
                                if (d.success) {
                                    _favCache = null;
                                    favs = await _getFavs(true);
                                    _folders = favs._folders || {};
                                    _buildMainTabs();
                                    _buildSidebar();
                                    _renderContent();
                                }
                                alert(d.message || (d.success ? '导入成功' : '导入失败: ' + (d.error || '未知')));
                            };
                            box.querySelector('#db-imp-merge').onclick = () => doImp('merge');
                            box.querySelector('#db-imp-over').onclick = () => doImp('overwrite');
                            mask.appendChild(box);
                            mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
                            document.body.appendChild(mask);
                        } catch (e) { alert('导入失败: ' + (e.message || e)); }
                    };
                    inp.click();
                });
                titleRow.append(title, exportBtn, importBtn, closeBtn);
                const _searchAndSelect = async (tagStr, postId) => {
                    overlay.remove();
                    // 替换选中：清掉旧的，只保留当前单图
                    _multiSelections.clear();
                    _multiSelections.add(Number(postId));
                    const sels = [..._multiSelections].map(id => ({ post_id: id }));
                    const pl = JSON.stringify({ selections: sels, merge: _multiMerge, image_connected: imageConnected() });
                    if (selWidget) selWidget.value = pl;
                    node.isChanged = true;
                    // 加载中占位
                    gridContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#888;font-size:16px;grid-column:1/-1;">⏳ 正在加载收藏的图片...</div>';
                    // 直接调 post API 拿到图片数据，不走搜索栏
                    try {
                        const r = await fetch('/danbooru_anima/post/' + postId);
                        const d = await r.json();
                        if (d.success && d.post) {
                            const p = d.post;
                            const post = {
                                id: p.id,
                                preview_url: p.preview_url || '',
                                large_url: p.large_url || '',
                                file_url: p.file_url || '',
                                is_video: false,
                                tags: Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || ''),
                                rating: p.rating || '',
                                score: p.score || 0,
                                width: p.width || 0,
                                height: p.height || 0,
                            };
                            renderGrid([post]);
                            if (d.classified) tagCache[post.id] = d.classified;
                            if (d.translations) {
                                Object.assign(_globalTagTranslations, d.translations);
                                tagTranslationCache[post.id] = d.translations;
                            }
                            setTimeout(() => {
                                for (const card of gridContainer.children) {
                                    if (card._postId === Number(postId)) {
                                        card.style.boxShadow = "0 0 0 3px #ffd93d";
                                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        setTimeout(() => { card.style.boxShadow = ""; }, 2000);
                                        break;
                                    }
                                }
                            }, 100);
                        }
                    } catch {}
                };
                // ── 侧边栏 + 内容区 ──
                const _tagCats = [
                    { key: 'artists', label: '🎨 画师' },
                    { key: 'characters', label: '👤 角色' },
                    { key: 'series', label: '📺 系列' },
                    { key: 'general', label: '🏷 通用' },
                ];
                let _folders = favs._folders || {};
                const mainTabBar = $el('div', { style: { display: 'flex', gap: '4px', borderBottom: '1px solid #e94560', marginBottom: '8px' } });
                const bodyRow = $el('div', { style: { display: 'flex', flex: 1, overflow: 'hidden', gap: '12px' } });
                const sidebar = $el('div', { style: { width: '180px', minWidth: '180px', overflow: 'auto', borderRight: '1px solid #0f3460', paddingRight: '8px', paddingTop: '4px' } });
                const contentArea = $el('div', { style: { flex: 1, overflow: 'auto', height: '500px' } });
                let activeMain = 'images';
                let activeCategory = 'images';
                let activeFolder = null;
                let _imgMode = 'multi';
                let _favSort = 'desc';
                const _selectedImgs = new Set();

                const _buildFavImg = (key, thumb, tagsStr, mode) => {
                    const isChk = _selectedImgs.has(key);
                    const chkHtml = '<div class="db-img-check" style="position:absolute;top:4px;right:4px;z-index:5;width:24px;height:24px;background:rgba(0,0,0,0.7);border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:' + (isChk ? '#ffd93d' : '#4fc3f7') + ';font-size:16px;">' + (isChk ? '☑' : '☐') + '</div>';
                    const selOv = isChk ? '<div style="position:absolute;inset:0;z-index:4;background:rgba(233,69,96,0.15);display:flex;align-items:center;justify-content:center;"><span style="font-size:48px;color:#e94560;text-shadow:0 2px 8px rgba(0,0,0,0.8);">✓</span></div>' : '';
                    const imgThumb = thumb
                        ? '<div style="width:100%;aspect-ratio:16/9;overflow:hidden;background:#0f3460;display:flex;align-items:center;justify-content:center;"><img src="/danbooru_anima/image_proxy?url=' + encodeURIComponent(thumb) + '" style="max-width:100%;max-height:100%;object-fit:contain;" loading="lazy"></div>'
                        : '<div style="width:100%;aspect-ratio:16/9;background:#0f3460;display:flex;align-items:center;justify-content:center;color:#555;font-size:28px;">🖼</div>';
                    return '<div class="db-fav-img" draggable="true" data-postid="' + key + '" data-tags="' + tagsStr.replace(/"/g, '&quot;') + '" data-cat="images" style="position:relative;background:#16213e;border-radius:6px;overflow:hidden;border:2px solid ' + (isChk ? '#e94560' : '#0f3460') + ';cursor:pointer;">'
                        + selOv + chkHtml + imgThumb
                        + '<div style="display:flex;gap:4px;padding:2px 6px 6px;">'
                        + '<button class="db-img-del" data-postid="' + key + '" style="flex:1;background:#3a1a1a;color:#e94560;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:12px;">🗑 删除</button>'
                        + '</div></div>';
                };
                const _getFolderKeys = (catKey) => {
                    const folders = _folders[catKey] || {};
                    const allInFolders = new Set();
                    for (const items of Object.values(folders)) {
                        for (const k of items) allInFolders.add(k);
                    }
                    return {
                        uncategorized: Object.keys(favs[catKey] || {}).filter(k => !allInFolders.has(k)),
                        folders,
                    };
                };
                const _makeFolderItems = (parentDiv, catKey) => {
                    const fdata = _getFolderKeys(catKey);
                    const total = Object.keys(favs[catKey] || {}).filter(k => k !== '_order').length;
                    const folders = Object.keys(fdata.folders).filter(f => f !== '__tmp');
                    const tmpItems = (fdata.folders['__tmp'] || []).length;
                    const subStyle = (sel) => ({ fontSize: '12px', padding: '3px 6px 3px 32px', cursor: 'pointer', color: sel ? '#4fc3f7' : '#888', borderRadius: '3px', marginBottom: '1px', background: sel ? '#0f3460' : 'transparent' });
                    const makeDropTarget = (el, targetFolder) => {
                        el.dataset.dropFolder = targetFolder;
                        el.addEventListener('dragenter', (e) => { e.preventDefault(); el.style.background = '#0f3460'; el.style.outline = '2px solid #e94560'; });
                        el.addEventListener('dragover', (e) => e.preventDefault());
                        el.addEventListener('dragleave', () => { el.style.background = ''; el.style.outline = ''; });
                        el.addEventListener('drop', (e) => {
                            e.preventDefault(); e.stopPropagation();
                            el.style.background = ''; el.style.outline = '';
                            const postIds = e.dataTransfer.getData('text/db-drag-ids');
                            if (!postIds) return;
                            const ids = JSON.parse(postIds);
                            const isUncat = el.dataset.dropUncat === '1';
                            const body = isUncat
                                ? JSON.stringify({ action: 'remove_from_all', category: 'images', item_keys: ids })
                                : JSON.stringify({ action: 'move', category: 'images', item_keys: ids, target_folder: targetFolder });
                            fetch('/danbooru_anima/favorites/folder', {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body
                            }).then(r => r.json()).then(d => {
                                if (d.success) _refreshPopupData();
                                else alert('移动失败: ' + (d.error || ''));
                            });
                        });
                    };
                    // 未分类
                    if (total > 0 && fdata.uncategorized.length > 0) {
                        const uc = $el('div', { textContent: '📂 未分类 (' + fdata.uncategorized.length + ')', style: subStyle(activeCategory === catKey && activeFolder === '__uncat'), onclick: (e) => { e.stopPropagation(); activeCategory = catKey; activeFolder = '__uncat'; _renderContent(); _buildSidebar(); } });
                        uc.dataset.dropUncat = '1';
                        makeDropTarget(uc, '__tmp'); // placeholder; 实际在 drop 里判断
                        parentDiv.appendChild(uc);
                    }
                    for (const fname of folders) {
                        const cnt = (fdata.folders[fname] || []).length;
                        const fdiv = $el('div', { textContent: '📁 ' + fname + ' (' + cnt + ')', style: subStyle(activeCategory === catKey && activeFolder === fname), onclick: (e) => { e.stopPropagation(); activeCategory = catKey; activeFolder = fname; _renderContent(); _buildSidebar(); } });
                        makeDropTarget(fdiv, fname);
                        fdiv.addEventListener('contextmenu', (e) => {
                            e.preventDefault(); e.stopPropagation();
                            const menu = $el('div', { style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', background: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px', padding: '4px', zIndex: 10001, minWidth: '140px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' } });
                            const addItem = (label, cb) => {
                                const item = $el('div', { textContent: label, style: { padding: '6px 12px', cursor: 'pointer', color: '#b0bec5', fontSize: '13px', borderRadius: '4px' }, onmouseenter: () => { item.style.background = '#0f3460'; }, onmouseleave: () => { item.style.background = 'transparent'; }, onclick: () => { menu.remove(); cb(); } });
                                menu.appendChild(item);
                            };
                            addItem('✏️ 重命名', () => {
                                const newName = prompt('新名称：', fname);
                                if (newName && newName.trim() && newName.trim() !== fname) {
                                    fetch('/danbooru_anima/favorites/folder', {
                                        method: 'POST', headers: {'Content-Type':'application/json'},
                                        body: JSON.stringify({ action: 'rename', category: catKey, name: fname, new_name: newName.trim() })
                                    }).then(r => r.json()).then(d => { if (d.success) _refreshPopupData(); else alert('重命名失败: ' + (d.error || '')); });
                                }
                            });
                            addItem('🗑 删除（内容→临时）', () => {
                                if (!confirm('确定删除文件夹「' + fname + '」？内容将移到 📦 临时。')) return;
                                fetch('/danbooru_anima/favorites/folder', {
                                    method: 'POST', headers: {'Content-Type':'application/json'},
                                    body: JSON.stringify({ action: 'delete', category: catKey, name: fname })
                                }).then(r => r.json()).then(d => { if (d.success) _refreshPopupData(); else alert('删除失败: ' + (d.error || '')); });
                            });
                            const closeMenu = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
                            setTimeout(() => document.addEventListener('click', closeMenu), 10);
                            document.body.appendChild(menu);
                        });
                        parentDiv.appendChild(fdiv);
                    }
                    if (tmpItems > 0) {
                        const tdiv = $el('div', { textContent: '📦 临时 (' + tmpItems + ')', style: { ...subStyle(activeCategory === catKey && activeFolder === '__tmp'), color: activeCategory === catKey && activeFolder === '__tmp' ? '#e94560' : '#666' }, onclick: (e) => { e.stopPropagation(); activeCategory = catKey; activeFolder = '__tmp'; _renderContent(); _buildSidebar(); } });
                        makeDropTarget(tdiv, '__tmp');
                        parentDiv.appendChild(tdiv);
                    }
                };
                const _buildMainTabs = () => {
                    mainTabBar.innerHTML = '';
                    const mains = [
                        { key: 'images', label: '🖼 图片', cnt: Object.keys(favs.images || {}).filter(k => k !== '_order').length },
                        { key: 'tags', label: '🏷 标签', cnt: _tagCats.reduce((s, c) => s + Object.keys(favs[c.key] || {}).filter(k => k !== '_order').length, 0) },
                    ];
                    for (const { key, label, cnt } of mains) {
                        const tab = $el('div', {
                            textContent: label + (cnt ? ' (' + cnt + ')' : ''),
                            style: { padding: '8px 18px', cursor: 'pointer', color: '#b0bec5', fontSize: '15px', borderRadius: '6px 6px 0 0', fontWeight: 'bold', background: activeMain === key ? '#0f3460' : 'transparent', borderBottom: activeMain === key ? '2px solid #e94560' : '2px solid transparent' },
                            onclick: () => {
                                if (activeMain === key) return;
                                activeMain = key;
                                activeCategory = key === 'images' ? 'images' : _tagCats[0].key;
                                activeFolder = null;
                                _buildMainTabs();
                                _buildSidebar();
                                _renderContent();
                            }
                        });
                        mainTabBar.appendChild(tab);
                    }
                };
                const _buildSidebar = () => {
                    sidebar.innerHTML = '';
                    if (activeMain === 'images') {
                        const imgTotal = Object.keys(favs.images || {}).filter(k => k !== '_order').length;
                        const imgDiv = $el('div', {
                            textContent: '🖼 图片' + (imgTotal ? ' (' + imgTotal + ')' : ''),
                            style: { padding: '8px 6px', cursor: 'pointer', color: activeCategory === 'images' ? '#4fc3f7' : '#b0bec5', fontSize: '14px', fontWeight: 'bold', borderRadius: '4px', background: activeCategory === 'images' ? '#0f3460' : 'transparent', marginBottom: '2px', userSelect: 'none' },
                            oncontextmenu: (e) => {
                                e.preventDefault(); e.stopPropagation();
                                const inpRow = $el('div', { style: { display: 'flex', gap: '4px', padding: '3px 6px 3px 32px', alignItems: 'center' } });
                                const inp = $el('input', { type: 'text', placeholder: '新文件夹名称', style: { flex: 1, padding: '4px 6px', borderRadius: '3px', border: '1px solid #e94560', background: '#16213e', color: '#e0e0e0', fontSize: '12px', outline: 'none' } });
                                const okBtn = $el('button', { textContent: '✓', style: { padding: '3px 8px', borderRadius: '3px', border: 'none', background: '#4caf50', color: '#fff', cursor: 'pointer', fontSize: '12px' }, onclick: () => { const name = inp.value.trim(); if (!name) return; fetch('/danbooru_anima/favorites/folder', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'create', category: 'images', name }) }).then(r => r.json()).then(d => { if (d.success) { _refreshPopupData(); } else alert('创建失败: ' + (d.error || '')); }); } });
                                const cancelBtn = $el('button', { textContent: '✕', style: { padding: '3px 8px', borderRadius: '3px', border: 'none', background: '#555', color: '#ccc', cursor: 'pointer', fontSize: '12px' }, onclick: () => { inpRow.remove(); } });
                                inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') okBtn.click(); if (ev.key === 'Escape') cancelBtn.click(); });
                                inpRow.append(inp, okBtn, cancelBtn);
                                imgDiv.after(inpRow);
                                setTimeout(() => inp.focus(), 50);
                            },
                            onclick: () => { activeCategory = 'images'; activeFolder = null; _renderContent(); _buildSidebar(); }
                        });
                        sidebar.appendChild(imgDiv);
                        _makeFolderItems(sidebar, 'images');
                    } else {
                        for (const { key, label } of _tagCats) {
                            const total = Object.keys(favs[key] || {}).filter(k => k !== '_order').length;
                            const catDiv = $el('div', {
                                textContent: label + (total ? ' (' + total + ')' : ''),
                                style: { padding: '6px 6px 6px 10px', cursor: 'pointer', color: activeCategory === key ? '#4fc3f7' : '#b0bec5', fontSize: '13px', fontWeight: 'bold', borderRadius: '3px', background: activeCategory === key ? '#0f3460' : 'transparent', marginBottom: '1px', userSelect: 'none' },
                                onclick: () => { activeCategory = key; activeFolder = null; _renderContent(); _buildSidebar(); }
                            });
                            sidebar.appendChild(catDiv);
                        }
                    }
                };
                const _renderContent = () => {
                    const catKey = activeCategory;
                    const items = favs[catKey] || {};
                    // 过滤：按文件夹
                    let keys;
                    if (activeFolder === null) {
                        keys = Object.keys(items);
                    } else if (activeFolder === '__uncat') {
                        keys = _getFolderKeys(catKey).uncategorized;
                    } else if (activeFolder === '__tmp') {
                        keys = (_folders[catKey]?.['__tmp'] || []);
                    } else {
                        keys = (_folders[catKey]?.[activeFolder] || []);
                    }
                    keys = keys.filter(k => k !== '_order');
                    if (!keys.length) {
                        const hint = activeFolder === '__uncat' ? '未分类' : (activeFolder || catKey);
                        contentArea.innerHTML = '<div style="text-align:center;color:#666;padding:30px;font-size:13px;">暂无内容（' + hint + '）</div>';
                        return;
                    }
                    if (catKey === 'images') {
                        console.log('[Fav] render images', {keysLen:keys.length, hasOrder:!!items._order, orderLen:items._order?.length, first3Keys:keys.slice(0,3), first3Order:items._order?.slice(0,3)});
                        // 排序（asc=先添加在前，desc=后添加在前）
                        if (!_favSort) _favSort = 'asc';
                        // 仅在"全部"视图用 _order（绕过 Object.keys 数字键重排），文件夹视图用 keys
                        const rawKeys = (activeFolder === null && items._order) ? items._order : keys;
                        const sortedKeys = _favSort === 'desc' ? [...rawKeys].reverse() : rawKeys;
                        const allCnt = keys.length;
                        const selCnt = _selectedImgs.size;
                        let html = '<div class="db-mode-bar" style="position:sticky;top:0;z-index:2;background:#1a1a2e;display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:6px 0 8px;border-bottom:1px solid #0f3460;">'
                            + '<span style="color:#e94560;font-size:13px;font-weight:bold;">☑ 多选</span>'
                            + '<button class="db-img-sel-all" style="padding:4px 10px;border-radius:4px;border:1px solid #0f3460;background:transparent;color:#4fc3f7;cursor:pointer;font-size:11px;">全选</button>'
                            + '<button class="db-img-sel-none" style="padding:4px 10px;border-radius:4px;border:1px solid #0f3460;background:transparent;color:#888;cursor:pointer;font-size:11px;">取消</button>'
                            + '<select class="db-fav-sort" style="padding:3px 6px;border-radius:4px;border:1px solid #0f3460;background:#16213e;color:#b0bec5;font-size:11px;cursor:pointer;margin-left:4px;">'
                            + '<option value="asc"' + (_favSort === 'asc' ? ' selected' : '') + '>⬆ 最早</option>'
                            + '<option value="desc"' + (_favSort === 'desc' ? ' selected' : '') + '>⬇ 最新</option>'
                            + '</select>';
                        if (selCnt > 0) {
                            html += '<button class="db-img-export" style="padding:6px 16px;border-radius:4px;border:none;background:#e94560;color:#fff;cursor:pointer;font-size:13px;font-weight:bold;">📤 输出 (' + selCnt + ')</button>';
                            html += '<button class="db-img-del-sel" style="padding:6px 16px;border-radius:4px;border:none;background:#3a1a1a;color:#e94560;cursor:pointer;font-size:13px;font-weight:bold;">🗑 删除选中</button>';
                        }
                        html += '<button class="db-img-move-folder" style="padding:6px 16px;border-radius:4px;border:none;background:#0f3460;color:#4fc3f7;cursor:pointer;font-size:13px;font-weight:bold;">📂 移动</button>';
                        html += '</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">';
                        for (const key of sortedKeys) {
                            const item = items[key];
                            if (!item) continue; // 跳过幽灵占位
                            const meta = item.cn || '{}';
                            let tagsStr = '';
                            try { const p = JSON.parse(meta); tagsStr = p.tags || ''; } catch { tagsStr = meta; }
                            html += _buildFavImg(key, item.thumb || '', tagsStr, _imgMode);
                        }
                        html += '</div>';
                        contentArea.innerHTML = html;
                    } else {
                        let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">';
                        for (const tag of keys) {
                            const item = items[tag];
                            const thumb = item?.thumb || '';
                            const cn = item?.cn || '';
                            const display = cn ? tag + ' (' + cn + ')' : tag;
                            const titleSet = item?.title || '';
                            html += '<div class="db-fav-card" data-tag="' + tag + '" data-cat="' + catKey + '" style="background:#16213e;border-radius:6px;overflow:hidden;border:1px solid #0f3460;cursor:pointer;">';
                            if (thumb) {
                                html += '<div style="width:100%;aspect-ratio:16/9;overflow:hidden;background:#0f3460;display:flex;align-items:center;justify-content:center;">'
                                    + '<img src="/danbooru_anima/image_proxy?url=' + encodeURIComponent(thumb) + '" style="max-width:100%;max-height:100%;object-fit:contain;" loading="lazy">'
                                    + '</div>';
                            } else {
                                html += '<div style="width:100%;aspect-ratio:16/9;background:#0f3460;display:flex;align-items:center;justify-content:center;color:#555;font-size:28px;">🏷</div>';
                            }
                            html += '<div class="db-fav-name" data-tag="' + tag + '" data-cat="' + catKey + '" style="padding:6px 8px;font-size:13px;word-break:break-all;font-weight:bold;">';
                            if (titleSet) html += '<span style="color:#ffd93d;">' + titleSet + '</span><br><span style="color:#888;font-size:11px;font-weight:normal;">' + tag + (cn ? ' (' + cn + ')' : '') + '</span>';
                            else html += '<span style="color:#4fc3f7;">' + display + '</span>';
                            html += '</div>';
                            html += '<div style="display:flex;gap:4px;padding:2px 6px 6px;">'
                                + '<button class="db-fav-title" data-tag="' + tag + '" data-cat="' + catKey + '" style="background:#2a2a3a;color:#ffd93d;border:none;border-radius:4px;padding:4px 6px;cursor:pointer;font-size:12px;">✏️</button>'
                                + '<button class="db-fav-del" data-tag="' + tag + '" data-cat="' + catKey + '" style="flex:1;background:#3a1a1a;color:#e94560;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:12px;">🗑 删除</button>'
                                + '<button class="db-fav-thumb" data-tag="' + tag + '" data-cat="' + catKey + '" style="flex:1;background:#1a2a3a;color:#4fc3f7;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:12px;">🖼 换图</button>'
                                + '</div></div>';
                        }
                        html += '</div>';
                        contentArea.innerHTML = html;
                    }
                };
                // ── 拖拽支持 ──
                contentArea.addEventListener('dragstart', (e) => {
                    const card = e.target.closest('.db-fav-img');
                    if (!card) { e.preventDefault(); return; }
                    const postId = card.dataset.postid;
                    if (!postId) { e.preventDefault(); return; }
                    let ids;
                    if (_imgMode === 'multi' && _selectedImgs.size > 0) {
                        ids = [..._selectedImgs].map(String);
                    } else {
                        ids = [postId];
                    }
                    e.dataTransfer.setData('text/db-drag-ids', JSON.stringify(ids));
                    e.dataTransfer.effectAllowed = 'move';
                    card.style.opacity = '0.5';
                    e.dataTransfer.setDragImage(card, 30, 30);
                    setTimeout(() => { card.style.opacity = ''; }, 0);
                });
                const _refreshPopupData = async () => {
                    _favCache = null;
                    favs = await _getFavs();
                    _folders = favs._folders || {};
                    _buildMainTabs();
                    _buildSidebar();
                    _renderContent();
                };
                _buildMainTabs();
                _buildSidebar();
                bodyRow.append(sidebar, contentArea);
                dialog.append(titleRow, mainTabBar, bodyRow);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                _renderContent();
                // ── 右键菜单（移动到文件夹） ──
                overlay.addEventListener('contextmenu', (e) => {
                    const card = e.target.closest('.db-fav-card, .db-fav-img');
                    if (!card) return;
                    e.preventDefault();
                    e.stopPropagation();
                    // 获取选中项的 key 和 category
                    let itemKey, catKey;
                    if (card.classList.contains('db-fav-img')) {
                        itemKey = card.dataset.postid;
                        catKey = 'images';
                    } else {
                        itemKey = card.dataset.tag;
                        catKey = card.dataset.cat;
                    }
                    if (!catKey || !itemKey) return;
                    if (catKey !== 'images') return; // 只有图片支持文件夹
                    // 构建文件夹列表
                    const folders = _folders[catKey] || {};
                    const folderNames = Object.keys(folders).filter(f => f !== '__tmp');
                    const picker = $el('div', {
                        style: {
                            position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px',
                            background: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px',
                            padding: '4px', zIndex: 10001, minWidth: '160px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                        }
                    });
                    const addOpt = (label, folder) => {
                        const opt = $el('div', {
                            textContent: label,
                            style: { padding: '6px 12px', cursor: 'pointer', color: '#b0bec5', fontSize: '13px', borderRadius: '4px' },
                            onmouseenter: () => { opt.style.background = '#0f3460'; },
                            onmouseleave: () => { opt.style.background = 'transparent'; },
                            onclick: async () => {
                                picker.remove();
                                if (folder === null) return; // 取消
                                if (folder === '__uncat') {
                                    await fetch('/danbooru_anima/favorites/folder', {
                                        method: 'POST', headers: {'Content-Type':'application/json'},
                                        body: JSON.stringify({ action: 'remove_from_all', category: catKey, item_keys: [itemKey] })
                                    });
                                } else {
                                    await fetch('/danbooru_anima/favorites/folder', {
                                        method: 'POST', headers: {'Content-Type':'application/json'},
                                        body: JSON.stringify({ action: 'move', category: catKey, item_keys: [itemKey], target_folder: folder })
                                    });
                                }
                                _refreshPopupData();
                            }
                        });
                        picker.appendChild(opt);
                    };
                    addOpt('📂 未分类', '__uncat');
                    for (const fname of folderNames) {
                        addOpt('📁 ' + fname, fname);
                    }
                    // 关闭
                    const closePicker = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closePicker); } };
                    setTimeout(() => document.addEventListener('click', closePicker), 10);
                    document.body.appendChild(picker);
                });
                // 排序 change 事件委托
                contentArea.addEventListener('change', (e) => {
                    if (e.target.matches('.db-fav-sort')) { _favSort = e.target.value; _renderContent(); }
                });
                const _searchTag = (tag) => {
                    if (!tag) return;
                    overlay.remove();
                    if (_clsPopup) { _clsPopup.remove(); _clsPopup = null; }
                    searchInput.value = tag.replace(/ /g, '_');
                    if (_hotActive) { _hotActive = false; Object.assign(hotBtn.style, _DEF_STYLE); _currentForceTags = null; }
                    doSearch(1);
                };
                overlay.addEventListener('click', async (e) => {
                    // 全选
                    if (e.target.closest('.db-img-sel-all')) {
                        contentArea.querySelectorAll('.db-fav-img').forEach(el => {
                            const pid = el.dataset.postid;
                            if (pid) _selectedImgs.add(pid);
                        });
                        _renderContent();
                        return;
                    }

                    // 取消全选
                    if (e.target.closest('.db-img-sel-none')) {
                        _selectedImgs.clear();
                        _renderContent();
                        return;
                    }
                    // 点击卡片 → 切换选中
                    const imgCard = e.target.closest('.db-fav-img');
                    if (imgCard && !e.target.closest('button') && !e.target.closest('.db-img-check')) {
                        const postId = imgCard.dataset.postid;
                        if (_selectedImgs.has(postId)) {
                            _selectedImgs.delete(postId);
                        } else {
                            _selectedImgs.add(postId);
                        }
                        // 重新渲染显示状态
                        const items = favs.images || {};
                        const item = items[postId];
                        const meta = item?.cn || '{}';
                        let t = '';
                        try { const p = JSON.parse(meta); t = p.tags || ''; } catch { t = meta; }
                        imgCard.outerHTML = _buildFavImg(postId, item?.thumb || '', t, _imgMode);
                        _renderContent();
                        return;
                    }
                    // 复选框切换
                    const chk = e.target.closest('.db-img-check');
                    if (chk) {
                        e.stopPropagation();
                        const card = chk.closest('.db-fav-img');
                        if (!card) return;
                        const postId = card.dataset.postid;
                        if (_selectedImgs.has(postId)) {
                            _selectedImgs.delete(postId);
                            chk.textContent = '☐';
                            chk.style.color = '#4fc3f7';
                        } else {
                            _selectedImgs.add(postId);
                            chk.textContent = '☑';
                            chk.style.color = '#ffd93d';
                        }
                        const cnt = overlay.querySelector('.db-sel-cnt');
                        if (cnt) cnt.textContent = _selectedImgs.size;
                        return;
                    }
                    // 图片分类 → 导出选中（多选模式）
                    const expBtn = e.target.closest('.db-img-export');
                    if (expBtn && _imgMode === 'multi') {
                        if (_selectedImgs.size === 0) return;
                        overlay.remove();
                        const postList = [];
                        const items = favs.images || {};
                        for (const pid of _selectedImgs) {
                            const item = items[pid];
                            if (item) {
                                const meta = item?.cn || '{}';
                                let tagsStr = '';
                                try { const p = JSON.parse(meta); tagsStr = p.tags || ''; } catch { tagsStr = meta; }
                                postList.push({
                                    id: Number(pid),
                                    preview_url: item.thumb || '',
                                    large_url: '',
                                    file_url: '',
                                    is_video: false,
                                    tags: tagsStr,
                                    rating: '',
                                    score: 0,
                                    width: 0, height: 0,
                                });
                            }
                        }
                        // 只渲染网格供浏览，不自动选中
                        if (selWidget) selWidget.value = "{}";
                        node.isChanged = true;
                        if (postList.length) renderGrid(postList);
                        _multiSelections.clear();
                        _selectedImgs.clear();
                        return;
                    }
                    // 多选 → 移动到文件夹
                    const moveBtn = e.target.closest('.db-img-move-folder');
                    if (moveBtn && _imgMode === 'multi') {
                        if (_selectedImgs.size === 0) return;
                        const folderNames = Object.keys(_folders.images || {}).filter(f => f !== '__tmp');
                        const picker = $el('div', {
                            style: { position: 'fixed', left: (e.clientX || 400) + 'px', top: (e.clientY || 300) + 'px', background: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px', padding: '4px', zIndex: 10001, minWidth: '200px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }
                        });
                        const pick = (label, target) => {
                            const opt = $el('div', {
                                textContent: label, style: { padding: '6px 12px', cursor: 'pointer', color: '#b0bec5', fontSize: '13px', borderRadius: '4px' },
                                onmouseenter: () => { opt.style.background = '#0f3460'; },
                                onmouseleave: () => { opt.style.background = 'transparent'; },
                                onclick: async () => {
                                    picker.remove();
                                    const ids = [..._selectedImgs].map(String);
                                    await fetch('/danbooru_anima/favorites/folder', {
                                        method: 'POST', headers: {'Content-Type':'application/json'},
                                        body: target === null
                                            ? JSON.stringify({ action: 'remove_from_all', category: 'images', item_keys: ids })
                                            : JSON.stringify({ action: 'move', category: 'images', item_keys: ids, target_folder: target })
                                    });
                                    _refreshPopupData();
                                }
                            });
                            picker.appendChild(opt);
                        };
                        pick('📂 未分类 (解除)', null);
                        for (const f of folderNames) pick('📁 ' + f, f);
                        const closePicker = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closePicker); } };
                        setTimeout(() => document.addEventListener('click', closePicker), 10);
                        document.body.appendChild(picker);
                        return;
                    }
                    // 批量删除选中
                    const delSelBtn = e.target.closest('.db-img-del-sel');
                    if (delSelBtn) {
                        if (!confirm(`确认删除选中的 ${_selectedImgs.size} 张图片？`)) return;
                        const ids = [..._selectedImgs];
                        const fileFolders = _favCache?._folders?.images;
                        for (const pid of ids) {
                            await fetch('/danbooru_anima/favorites/remove', {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ tag: pid, category: 'images' })
                            });
                            if (_favCache?.images) {
                                delete _favCache.images[pid];
                                const o = _favCache.images._order;
                                if (o) { const idx = o.indexOf(pid); if (idx >= 0) o.splice(idx, 1); }
                            }
                            if (fileFolders) {
                                for (const fname of Object.keys(fileFolders)) {
                                    const arr = fileFolders[fname];
                                    const idx = arr.indexOf(pid);
                                    if (idx >= 0) arr.splice(idx, 1);
                                }
                            }
                        }
                        _selectedImgs.clear();
                        _refreshPopupData();
                        return;
                    }
                    // 单张删除
                    const imgDel = e.target.closest('.db-img-del');
                    if (imgDel) {
                        const postId = imgDel.dataset.postid;
                        if (!confirm('确认删除这张图片？')) return;
                        await fetch('/danbooru_anima/favorites/remove', {
                            method: 'POST', headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ tag: postId, category: 'images' })
                        });
                        if (_favCache?.images) {
                            delete _favCache.images[postId];
                            const o = _favCache.images._order;
                            if (o) { const idx = o.indexOf(postId); if (idx >= 0) o.splice(idx, 1); }
                        }
                        // 从所有文件夹中移除
                        const folders = _favCache?._folders?.images;
                        if (folders) {
                            for (const fname of Object.keys(folders)) {
                                const arr = folders[fname];
                                const idx = arr.indexOf(postId);
                                if (idx >= 0) arr.splice(idx, 1);
                            }
                        }
                        _renderContent();
                        return;
                    }
                    // ✏️ 修改标题（内联输入）
                    const titleBtn = e.target.closest('.db-fav-title');
                    if (titleBtn) {
                        const tag = titleBtn.dataset.tag;
                        const cat = titleBtn.dataset.cat;
                        const item = _favCache?.[cat]?.[tag];
                        const oldTitle = item?.title || '';
                        // 在 contentArea 顶部插入输入框
                        const inputRow = $el('div', { style: { padding: '8px 0', display: 'flex', gap: '8px', alignItems: 'center' } });
                        const inp = $el('input', {
                            type: 'text', value: oldTitle, placeholder: '自定义显示名（不修改搜索标签）',
                            style: { flex: 1, padding: '8px 12px', borderRadius: '4px', border: '1px solid #e94560', background: '#16213e', color: '#e0e0e0', fontSize: '14px', outline: 'none' }
                        });
                        const okBtn = $el('button', {
                            textContent: '确定', style: { padding: '8px 16px', borderRadius: '4px', border: 'none', background: '#e94560', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
                            onclick: async () => {
                                const cleanTitle = inp.value.trim();
                                await fetch('/danbooru_anima/favorites/add', {
                                    method: 'POST', headers: {'Content-Type':'application/json'},
                                    body: JSON.stringify({ tag, category: cat, thumb_url: item?.thumb || '', cn: item?.cn || '', title: cleanTitle })
                                });
                                if (_favCache?.[cat]?.[tag]) _favCache[cat][tag].title = cleanTitle;
                                inputRow.remove();
                                _renderContent();
                            }
                        });
                        const cancelBtn = $el('button', {
                            textContent: '取消', style: { padding: '8px 16px', borderRadius: '4px', border: '1px solid #555', background: '#2a2a3a', color: '#ccc', cursor: 'pointer', fontSize: '13px' },
                            onclick: () => inputRow.remove()
                        });
                        inputRow.append(inp, okBtn, cancelBtn);
                        contentArea.prepend(inputRow);
                        inp.focus();
                        inp.select();
                        return;
                    }
                    // 点击卡片（缩略图区域）→ 搜索
                    const card = e.target.closest('.db-fav-card');
                    if (card && !e.target.closest('button')) {
                        const nameDiv = card.querySelector('.db-fav-name');
                        if (nameDiv) _searchTag(nameDiv.dataset.tag);
                        return;
                    }
                    // 点击标签名 → 搜索
                    const nameDiv = e.target.closest('.db-fav-name');
                    if (nameDiv) { _searchTag(nameDiv.dataset.tag); return; }
                    const delBtn = e.target.closest('.db-fav-del');
                    if (delBtn) {
                        const tag = delBtn.dataset.tag;
                        const cat = delBtn.dataset.cat;
                        await fetch('/danbooru_anima/favorites/remove', {
                            method: 'POST', headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ tag, category: cat })
                        });
                        if (_favCache?.[cat]) delete _favCache[cat][tag];
                        _renderContent();
                        return;
                    }
                    const thumbBtn = e.target.closest('.db-fav-thumb');
                    if (thumbBtn) {
                        const tag = thumbBtn.dataset.tag;
                        const cat = thumbBtn.dataset.cat;
                        var _rating = ["general"];
                        // 立即显示弹窗
                        const picker = $el('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001 } });
                        const box = $el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', background: '#16213e', borderRadius: '8px', maxWidth: '640px', overflow: 'hidden' } });
                        const ratingBar = $el('div', { style: { display: 'flex', gap: '4px', padding: '8px 12px', borderBottom: '1px solid #333' } });
                        const ratings = [
                            {v: [], l: "🔘 全部"},
                            {v: ["general"], l: "🟢 普通"},
                            {v: ["general","sensitive"], l: "🟡 敏感"},
                            {v: ["general","sensitive","questionable"], l: "🟠 擦边"},
                            {v: ["general","sensitive","questionable","explicit"], l: "🔴 R18"},
                        ];
                        ratings.forEach(function(rt) {
                            var btn = $el('span', { textContent: rt.l, style: { padding: '3px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', background: rt.v.join(',') === _rating.join(',') ? '#0f3460' : 'transparent', color: rt.v.join(',') === _rating.join(',') ? '#4fc3f7' : '#888' }, onclick: function() {
                                _rating = rt.v;
                                ratingBar.querySelectorAll('span').forEach(function(b){b.style.background='transparent';b.style.color='#888';});
                                btn.style.background='#0f3460';btn.style.color='#4fc3f7';
                                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:30px;">加载中...</div>';
                                doSearch(tag);
                            }});
                            ratingBar.appendChild(btn);
                        });
                        box.appendChild(ratingBar);
                        const grid = $el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '6px', padding: '16px', maxHeight: '500px', overflow: 'auto' } });
                        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:30px;">加载中...</div>';
                        box.appendChild(grid);
                        picker.appendChild(box);
                        picker.onclick = (ev) => { if (ev.target === picker) picker.remove(); };
                        document.body.appendChild(picker);
                        async function doSearch(queryTag) { console.log('[THUMB] doSearch queryTag='+queryTag+' rating='+JSON.stringify(_rating));
                            try {
                                const r = await fetch('/danbooru_anima/search', {
                                    method: 'POST', headers: {'Content-Type':'application/json'},
                                    body: JSON.stringify({ tags: queryTag, page: 1, limit: 36, rating: _rating, order: "score" })
                                });
                                const d = await r.json();
                                grid.innerHTML = '';
                                if (d.success && d.posts?.length) {
                                for (const p of d.posts.slice(0, 36)) {
                                    const imgUrl = p.preview_url || p.large_url || '';
                                    const img = $el('img', {
                                        src: '/danbooru_anima/image_proxy?url=' + encodeURIComponent(imgUrl),
                                        style: { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer', border: '2px solid transparent' },
                                        onclick: async () => {
                                            await fetch('/danbooru_anima/favorites/update_thumb', {
                                                method: 'POST', headers: {'Content-Type':'application/json'},
                                                body: JSON.stringify({ tag, category: cat, thumb_url: imgUrl })
                                            });
                                            if (_favCache?.[cat]?.[tag]) _favCache[cat][tag].thumb = imgUrl;
                                            picker.remove();
                                            _renderContent();
                                        }
                                    });
                                    grid.appendChild(img);
                                }
                            }
                        } catch(e) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#e94560;padding:30px;">加载失败</div>'; }
                        return;
                    }
                    doSearch(tag);
                    }
                });
            } catch (err) {
                alert('⭐ 收藏夹错误: ' + (err?.message || err));
            }
            };
            const favBtn = $el('button', {
                textContent: '⭐', title: '收藏夹',
                style: { padding: '10px 14px', borderRadius: '6px', border: 'none', background: 'transparent', color: '#ffd93d', cursor: 'pointer', fontSize: '20px' }
            });
            favBtn.onclick = openFavPopup;
            // ── 分级过滤复选框（仿 D站画廊） ──
            const _activeRatings = new Set();
            const RATING_MAP = { "general": "普通", "sensitive": "敏感", "questionable": "可疑", "explicit": "R18" };
            const _ratAll = { checked: true };  // "所有分级"未选中时 true
            const ratingBar = $el("div", { style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "16px" } });
            const allCb = $el("input", { type: "checkbox", checked: true, style: { margin: "0 2px 0 4px", cursor: "pointer" } });
            allCb.onchange = () => {
                _activeRatings.clear();
                _ratAll.checked = allCb.checked;
                for (const cb of ratingCbs) cb.checked = false;
                doSearch(1);
                saveRatingState();
            };
            ratingBar.appendChild(allCb);
            ratingBar.appendChild($el("span", { textContent: "所有", style: { color: "#ccc", cursor: "pointer" },
                onclick: () => { allCb.checked = !allCb.checked; allCb.onchange(); } }));
            const ratingCbs = [];
            for (const val of ["general", "sensitive", "questionable", "explicit"]) {
                const cb = $el("input", { type: "checkbox", checked: false, style: { margin: "0 2px 0 4px", cursor: "pointer" } });
                ratingCbs.push(cb);
                cb.onchange = () => {
                    _ratAll.checked = false; allCb.checked = false;
                    if (cb.checked) _activeRatings.add(val);
                    else _activeRatings.delete(val);
                    if (_activeRatings.size === 0) { _ratAll.checked = true; allCb.checked = true; }
                    doSearch(1);
                    saveRatingState();
                };
                ratingBar.appendChild(cb);
                const lbl = RATING_MAP[val];
                const clr = { "general": "#4caf50", "sensitive": "#2196f3", "questionable": "#ff9800", "explicit": "#e94560" }[val];
                ratingBar.appendChild($el("span", { textContent: lbl, style: { color: clr, cursor: "pointer" },
                    onclick: () => { cb.checked = !cb.checked; cb.onchange(); } }));
            }

            // ── 模糊搜下拉 ──
            const acList = $el("div", {
                style: {
                    position: "absolute", top: "100%", left: "6px", right: "6px", zIndex: 1000,
                    display: "none", maxHeight: "240px", overflowY: "auto",
                    background: "#1a1a2e", border: "1px solid #0f3460", borderRadius: "0 0 4px 4px",
                    fontSize: "12px",
                }
            });

            // ── 语义搜索启用弹窗（确认 + 进度） ──
            const _showInitDialog = (msg) => new Promise(resolve => {
                const mask = $el("div", { style: { position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center" } });
                const box = $el("div", { style: { background:"#1a1a2e",border:"1px solid #0f3460",borderRadius:"12px",padding:"24px 28px",maxWidth:"400px",textAlign:"center",boxShadow:"0 8px 32px rgba(0,0,0,0.5)" } });
                const p = $el("p", { textContent: msg, style: { color:"#b0bec5",fontSize:"13px",lineHeight:1.8,whiteSpace:"pre-wrap",marginBottom:"16px" } });
                const btnRow = $el("div", { style: { display:"flex",gap:"10px",justifyContent:"center" } });
                const noBtn = $el("button", { textContent:"取消", style: { padding:"8px 20px",borderRadius:"6px",border:"1px solid #555",background:"transparent",color:"#888",cursor:"pointer",fontSize:"13px" }, onclick: () => { mask.remove(); resolve(false); } });
                const yesBtn = $el("button", { textContent:"开始初始化", style: { padding:"8px 20px",borderRadius:"6px",border:"none",background:"#e94560",color:"#fff",cursor:"pointer",fontSize:"13px",fontWeight:"bold" }, onclick: () => { mask.remove(); resolve(true); } });
                btnRow.append(noBtn, yesBtn); box.append(p, btnRow); mask.appendChild(box); document.body.appendChild(mask);
            });

            const showAc = (items, loading) => {
                acList.innerHTML = "";
                if (loading) {
                    acList.innerHTML = '<div style="padding:8px;text-align:center;color:#888;font-size:16px;">⏳ 搜索中...</div>';
                    acList.style.display = "block"; return;
                }
                if (!items?.length) { acList.style.display = "none"; return; }
                const normalItems = items;
                for (const item of normalItems) {
                    const row = $el("div", {
                        style: { padding: "5px 8px", cursor: "pointer", borderBottom: "1px solid #16213e", color: "#e0e0e0", display: "flex", justifyContent: "space-between", gap: "8px" },
                        onclick: () => { searchInput.value = item.tag.replace(/ /g, '_'); acList.style.display = "none"; if (_hotActive) { _hotActive = false; Object.assign(hotBtn.style, _DEF_STYLE); _currentForceTags = null; } doSearch(1); },
                        onmouseover: () => { row.style.background = "#0f3460"; },
                        onmouseout: () => { row.style.background = "transparent"; },
                    });
                    row.append(
                        $el("span", { textContent: item.cn ? `${item.cn} (${item.tag})` : item.tag }),
                        $el("span", { textContent: item.src || "", style: { color: "#888", fontSize: "10px", flexShrink: 0 } })
                    );
                    acList.appendChild(row);
                }
                // "搜云端"按钮——本地结果少于 6 个时显示
                if (normalItems.length < 6) {
                    const _q = searchInput?.value?.trim() || "";
                    const btn = $el("div", {
                        textContent: _semanticActive ? "🧠 语义搜索" : "☁️ 搜云端（语义匹配）",
                        style: { padding: "6px 8px", cursor: "pointer", textAlign: "center", color: "#ce93d8", fontSize: "11px", borderTop: "1px solid #0f3460" },
                        onclick: async () => {
                            if (!_vecReady) {
                                const ok = await _ensureVecReady();
                                if (!ok) return;
                            }
                            btn.textContent = "⏳ 搜索中...";
                            try {
                                let tags;
                                if (_semanticActive) {
                                    const r = await fetch("/danbooru_anima/vec_search", {
                                        method: "POST", headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ query: _q, top_k: 20 }),
                                    });
                                    const d = await r.json();
                                    tags = (d.tags || []).map(t => ({
                                        tag: t.name,
                                        cn: t.cn_name,
                                        src: `🧠 ${(t.score * 100).toFixed(0)}%`,
                                    }));
                                } else {
                                    const r = await fetch("/danbooru_anima/fuzzy_tags", {
                                        method: "POST", headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ query: _q, cloud: true }),
                                    });
                                    const d = await r.json();
                                    tags = d.tags || [];
                                }
                                acCache[_q] = tags;
                                showAc(tags);
                            } catch { showAc(normalItems); }
                        },
                        onmouseover: () => { btn.style.background = "#0f3460"; },
                        onmouseout: () => { btn.style.background = "transparent"; },
                    });
                    acList.appendChild(btn);
                }
                acList.style.display = "block";
            };

            // ── 输入即模糊搜索 ──
            let _searchTimer = null;
            searchInput.oninput = () => {
                const q = searchInput.value.trim();
                if (!q) { acList.style.display = "none"; return; }
                clearTimeout(_searchTimer);
                _searchTimer = setTimeout(async () => {
                    if (!_semanticActive && acCache[q]) { showAc(acCache[q]); return; }
                    // 延迟显示加载提示（请求超 200ms 才闪现，避免频繁闪烁）
                    const loadingTimer = setTimeout(() => showAc(null, true), 200);
                    try {
                        let tags;
                        if (_semanticActive) {
                            if (!_vecReady) {
                                const ok = await _ensureVecReady();
                                if (!ok) { clearTimeout(loadingTimer); showAc([]); return; }
                            }
                            const r = await fetch("/danbooru_anima/vec_search", {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ query: q, top_k: 15 }),
                            });
                            const d = await r.json();
                            if (d.error && !d.tags?.length) {
                                tags = [{ tag: "⏳ " + d.error, cn: "", src: "" }];
                            } else {
                                tags = (d.tags || []).map(t => ({
                                    tag: t.name,
                                    cn: t.cn_name || "",
                                    src: `🧠 ${(t.score * 100).toFixed(0)}%`,
                                }));
                            }
                        } else {
                            const r = await fetch("/danbooru_anima/fuzzy_tags", {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ query: q }),
                            });
                            const d = await r.json();
                            tags = d.tags || [];
                        }
                        clearTimeout(loadingTimer);
                        if (!_semanticActive) acCache[q] = tags;
                        showAc(tags);
                    } catch { clearTimeout(loadingTimer); showAc([]); }
                }, 100);
            };
            searchInput.onkeydown = (e) => {
                if (e.key === "Enter") {
                    clearTimeout(_searchTimer);
                    const q = searchInput.value.trim();
                    if (!q) return;
                    if (_hotActive) { _hotActive = false; Object.assign(hotBtn.style, _DEF_STYLE); _currentForceTags = null; }
                    doSearch(1);
                }
                if (e.key === "Escape") acList.style.display = "none";
            };

            // 点击其他地方关闭下拉
            document.addEventListener("click", (e) => {
                if (!searchBar.contains(e.target)) acList.style.display = "none";
            });
            // ── ☆ 收藏按钮事件委托（覆盖 TAGS 弹窗） ──
            document.addEventListener("click", async (e) => {
                const star = e.target.closest(".db-fav-star");
                if (!star) return;
                e.stopPropagation();
                const tag = star.dataset.tag;
                const cat = star.dataset.cat;
                // 缩略图：优先用 _lastThumbUrl，其次 overlay 上的 data-thumbUrl
                let thumbUrl = _lastThumbUrl || (document.querySelector('.db-tag-overlay-content')?.dataset?.thumbUrl) || '';
                _lastThumbUrl = '';  // 用完清空
                star.textContent = "⏳";
                const cn = tagTranslations[tag] || _globalTagTranslations[tag] || '';
                const result = await _toggleFav(tag, cat, thumbUrl, cn);
                star.textContent = result === 'added' ? '★' : '☆';
                star.style.color = result === 'added' ? '#ffd93d' : '#888';
                star.title = result === 'added' ? '取消收藏' : '收藏';
            });

            searchBar.append(searchInput, acList, searchBtn, hotBtn, semBtn, favBtn, ratingBar);
            container.appendChild(searchBar);

            // ═══════════ 顶部信息栏（放在搜索栏和网格之间，永远可见） ═══════════
            const infoBar = $el("div", {
                style: { display: "block", background: "#0f3460", borderBottom: "1px solid #16213e", flexShrink: 0, padding: "4px 8px", color: "#e0e0e0", fontSize: "10px", lineHeight: "1.5", maxHeight: "60px", overflow: "auto" }
            });
            infoBar.textContent = "💡 点击帖子tag图标 → 看标签";
            infoBar.style.fontSize = "14px";
            container.appendChild(infoBar);

            // ═══════════ 分页工具条（按钮在顶部，不用到底部去翻页） ═══════════
            const pageToolbar = $el("div", {
                style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "6px", padding: "4px 8px", background: "#16213e", borderBottom: "1px solid #0f3460", flexShrink: 0 }
            });
            const pageStatus = $el("span", { textContent: "", style: { color: "#a0a0a0", fontSize: "13px", marginRight: "auto" } });
            // prevBtn/nextBtn 在底栏中定义，稍后移入 pageToolbar

            // ═══════════ 标签弹窗（毛玻璃覆盖网格中间） ═══════════
            const overlay = $el("div", {
                style: {
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 9999,
                    display: "none", justifyContent: "center", alignItems: "center",
                    background: "rgba(0,0,0,0.4)", backdropFilter: "blur(3px)",
                    WebkitBackdropFilter: "blur(3px)", transition: "opacity 0.25s",
                },
                onclick: (e) => { if (e.target === overlay) hideOverlay(); }
            });
            const overlayContent = $el("div", {
                style: {
                    background: "rgba(26,26,46,0.92)", border: "1px solid #0f3460",
                    borderRadius: "10px", padding: "16px", margin: "20px",
                    maxWidth: "90%", maxHeight: "70%", overflow: "auto",
                    color: "#e0e0e0", fontSize: "13px", lineHeight: "1.7",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }
            });
            overlay.appendChild(overlayContent);
            document.body.appendChild(overlay);
            const showOverlay = (html) => {
                overlayContent.classList.add("db-tag-overlay-content");
                overlayContent.innerHTML = html;
                overlay.style.display = "flex";
                overlay.style.opacity = "1";
                // 同步缩略图 URL 到 overlay 上，供 ☆ 收藏用
                if (_lastThumbUrl) overlayContent.dataset.thumbUrl = _lastThumbUrl;
            };
            const hideOverlay = () => {
                overlay.style.opacity = "0";
                setTimeout(() => { overlay.style.display = "none"; }, 250);
            };
            const showTagOverlay = async (postId) => {
                if (!_favCache) _getFavs();  // 预加载收藏状态
                showOverlay("<div style='text-align:center;color:#888;'>⏳ 加载标签中...</div>");
                const cached = tagCache[postId];
                if (cached) {
                    tagTranslations = tagTranslationCache[postId] || {};
                    Object.assign(tagTranslations, _globalTagTranslations);
                    showOverlay(buildTagHtml(cached));
                    return;
                }
                try {
                    const resp = await fetch(`/danbooru_anima/post/${postId}`);
                    const data = await resp.json();
                    if (data.success && data.classified) {
                        tagCache[postId] = data.classified;
                        tagTranslations = data.translations || {};
                        if (data.translations) Object.assign(_globalTagTranslations, data.translations);
                        const tCount = Object.keys(tagTranslations).length;
                        const info = tCount > 0 ? `<div style="text-align:center;color:#6bcb77;font-size:12px;margin-top:6px;">✅ 已翻译 ${tCount} 个标签</div>` : '';
                        showOverlay(buildTagHtml(data.classified) + info);
                    } else {
                        showOverlay("<div style='text-align:center;color:#e94560;'>加载标签失败</div>");
                    }
                } catch {
                    showOverlay("<div style='text-align:center;color:#e94560;'>网络错误</div>");
                }
            };

            // ── 分序号按钮栏 ──
            const fusionBar = $el("div", { style: { display: "none", padding: "8px 12px", borderBottom: "1px solid #0f3460", flexShrink: 0, alignItems: "center", gap: "10px", flexWrap: "wrap" } });
            const fusionHdr = $el("span", { textContent: "分序号", style: { color: "#e94560", fontSize: "14px", fontWeight: "bold", marginRight: "4px" } });
            fusionBar.appendChild(fusionHdr);
            const fusionBtns = {};
            const slotInfo = { 1: { label: "质量·计数·通用", color: "#4fc3f7" }, 2: { label: "角色·系列", color: "#e94560" }, 3: { label: "画师", color: "#6bcb77" } };
            function mkSlotBtn(n) {
                const b = $el("button", {
                    textContent: n + " " + slotInfo[n].label,
                    style: { padding: "8px 18px", borderRadius: "6px", border: "2px solid " + slotInfo[n].color, cursor: "pointer", fontSize: "14px", fontWeight: "bold", background: n === _fusionActiveSlot ? slotInfo[n].color : "#1a1a2e", color: n === _fusionActiveSlot ? "#fff" : slotInfo[n].color }
                });
                b.onclick = () => {
                    if (n === 2 && _sync12) _sync12 = false; // 手动点 2 号关闭同步
                    _fusionActiveSlot = n;
                    updateSlotBtnStyles();
                };
                return b;
            }
            function updateSlotBtnStyles() {
                for (const [k, v] of Object.entries(fusionBtns)) {
                    const n = Number(k);
                    const active = n === _fusionActiveSlot;
                    v.style.background = active ? slotInfo[n].color : "#1a1a2e";
                    v.style.color = active ? "#fff" : slotInfo[n].color;
                }
                if (_syncBtn) _syncBtn.style.background = _sync12 ? "#4fc3f7" : "transparent";
            }
            const b1 = mkSlotBtn(1); fusionBtns[1] = b1; fusionBar.appendChild(b1);
            const _syncBtn = $el("button", { textContent: "🔗", title: "2号同步1号", style: { padding: "8px 10px", borderRadius: "6px", border: "2px solid #4fc3f7", cursor: "pointer", fontSize: "14px", background: "transparent", color: "#4fc3f7" } });
            _syncBtn.onclick = () => {
                _sync12 = !_sync12;
                if (_sync12) {
                    // 2号清空，同步成1号
                    _fusionSlots[2].clear();
                    for (const id of _fusionSlots[1]) _fusionSlots[2].add(id);
                    // 只更新 1/2 号涉及的卡片角标，不碰 3 号和其他卡
                    const slotBg = { 1: "#4fc3f7", 2: "#e94560", 3: "#6bcb77" };
                    const affected = new Set();
                    for (const id of _fusionSlots[1]) affected.add(id);
                    for (const id of _fusionSlots[2]) affected.add(id);
                    for (const pid of affected) {
                        const card = gridContainer.querySelector(`[data-postid="${pid}"]`) || gridContainer.querySelector(`[data-postid="${Number(pid)}"]`);
                        if (!card) continue;
                        // 重建这张卡的角标
                        let badge = card.querySelector(".db-fusion-badge");
                        const has1 = _fusionSlots[1].has(pid);
                        const has2 = _fusionSlots[2].has(pid);
                        const slots = [];
                        if (has1) slots.push(1);
                        if (has2) slots.push(2);
                        // 检查3号
                        if (_fusionSlots[3].has(pid)) slots.push(3);
                        if (slots.length === 0) {
                            if (badge) badge.remove();
                            card.style.border = "2px solid transparent";
                            const ov = card.querySelector(".db-sel-overlay");
                            if (ov) ov.style.display = "none";
                        } else {
                            if (!badge) {
                                badge = $el("div", { className: "db-fusion-badge", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: 6, display: "flex", gap: "3px" } });
                                card.appendChild(badge);
                            }
                            badge.style.display = "flex";
                            badge.innerHTML = slots.map(n => `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:${slotBg[n]};color:#1a1a2e;font-size:11px;font-weight:bold;">${n}</span>`).join("");
                            const lastS = slots[slots.length - 1];
                            card.style.border = "2px solid " + (slotBg[lastS] || "#4fc3f7");
                            let ov = card.querySelector(".db-sel-overlay");
                            if (!ov) { ov = $el("div", { className: "db-sel-overlay", style: { position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "3px" } }); card.appendChild(ov); }
                            ov.style.display = "block";
                            if (slots.length === 1) {
                                const colors = { 1: "rgba(79,195,247,0.15)", 2: "rgba(233,69,96,0.15)", 3: "rgba(107,203,119,0.15)" };
                                ov.style.background = colors[slots[0]] || "rgba(255,255,255,0.06)";
                            } else {
                                ov.style.background = "rgba(255,255,255,0.06)";
                            }
                        }
                    }
                    _fusionActiveSlot = 1;
                }
                updateSlotBtnStyles();
                refreshFusionBar();
            };
            fusionBar.appendChild(_syncBtn);
            const b2 = mkSlotBtn(2); fusionBtns[2] = b2; fusionBar.appendChild(b2);
            const b3 = mkSlotBtn(3); fusionBtns[3] = b3; fusionBar.appendChild(b3);
            // 各序号计数
            const fusionClearBtn = $el("button", { textContent: "✕ 清空当前", style: { padding: "8px 14px", borderRadius: "6px", border: "1px solid #555", background: "transparent", color: "#888", cursor: "pointer", fontSize: "13px", marginLeft: "8px" } });
            const fusionClearAllBtn = $el("button", { textContent: "✕✕ 清空全部", style: { padding: "8px 14px", borderRadius: "6px", border: "1px solid #e94560", background: "transparent", color: "#e94560", cursor: "pointer", fontSize: "13px" } });
            fusionClearAllBtn.onclick = () => {
                for (const n of [1, 2, 3]) _fusionSlots[n].clear();
                gridContainer.querySelectorAll(".db-fusion-badge").forEach(b => b.remove());
                gridContainer.querySelectorAll(".db-sel-overlay").forEach(o => o.style.display = "none");
                gridContainer.querySelectorAll("[style*='border']").forEach(c => { if (c.style && c.style.border && c.style.border !== "none") c.style.border = ""; });
                refreshFusionBar();
            };
            fusionClearBtn.onclick = () => {
                const slot = _fusionActiveSlot;
                _fusionSlots[slot].clear();
                // 只清除当前序号的卡片标记，不影响其他序号
                const slotBg = { 1: "#4fc3f7", 2: "#e94560", 3: "#6bcb77" };
                const selOverlay = { 1: "rgba(79,195,247,0.15)", 2: "rgba(233,69,96,0.15)", 3: "rgba(107,203,119,0.15)" };
                gridContainer.querySelectorAll(".db-fusion-badge").forEach(badge => {
                    const spans = badge.querySelectorAll("span");
                    let found = false;
                    spans.forEach(sp => {
                        if (sp.textContent.trim() === String(slot)) {
                            sp.remove();
                            found = true;
                        }
                    });
                    if (found) {
                        const card = badge.parentElement;
                        // 还有别的序号吗？
                        const remaining = badge.querySelectorAll("span");
                        if (remaining.length === 0) {
                            badge.remove();
                            if (card) {
                                card.querySelectorAll(".db-sel-overlay").forEach(o => o.style.display = "none");
                                if (card.style) card.style.border = "2px solid transparent";
                            }
                        } else {
                            // 更新边框颜色为最后一个序号的颜色
                            const lastIdx = remaining[remaining.length - 1].textContent.trim();
                            if (card && card.style) {
                                card.style.border = "2px solid " + (slotBg[lastIdx] || "#4fc3f7");
                                const ov = card.querySelector(".db-sel-overlay");
                                if (ov) { ov.style.background = selOverlay[lastIdx] || "rgba(255,255,255,0.06)"; ov.style.display = "block"; }
                            }
                        }
                    }
                });
                refreshFusionBar();
            };
            const fusionCnt = { 1: $el("span", { style: { color: "#888", fontSize: "10px", marginLeft: "4px" } }), 2: null, 3: null };

            function writeFusionWidget() {
                if (!fusionWidget) return;
                const data = {};
                for (const n of [1, 2, 3]) {
                    if (_fusionSlots[n].size > 0) data[n] = [..._fusionSlots[n]].map(Number);
                }
                fusionWidget.value = JSON.stringify(data);
                node.isChanged = true;
            }

            function refreshFusionBar() {
                const show = _tagFusionEnabled;
                fusionBar.style.display = show ? "flex" : "none";
                if (!show) return;
                const slen1 = _fusionSlots[1].size;
                const slen2 = _fusionSlots[2].size;
                const slen3 = _fusionSlots[3].size;
                const _sc = { 1: "#4fc3f7", 2: "#e94560", 3: "#6bcb77" };
                fusionCnt[1].innerHTML = `<span style="color:${_sc[1]};font-size:14px;font-weight:bold;">1号:${slen1}</span> <span style="color:#555;">|</span> <span style="color:${_sc[2]};font-size:14px;font-weight:bold;">2号:${slen2}</span> <span style="color:#555;">|</span> <span style="color:${_sc[3]};font-size:14px;font-weight:bold;">3号:${slen3}</span>`;
                // 计数只append一次
                if (!fusionCnt[1].parentNode) fusionBar.appendChild(fusionCnt[1]);
                if (!fusionClearBtn.parentNode) fusionBar.appendChild(fusionClearBtn);
                if (!fusionClearAllBtn.parentNode) fusionBar.appendChild(fusionClearAllBtn);
                writeFusionWidget();
            }

            // ═══════════ 图片网格 ═══════════
            const gridContainer = $el("div", {
                style: { flex: "1 1 auto", overflowY: "auto", padding: "6px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", alignContent: "start", minHeight: "200px" }
            });
            container.appendChild(fusionBar);
            container.appendChild(gridContainer);

            // ═══════════ 底栏 ═══════════
            const footer = $el("div", {
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "#16213e", borderTop: "1px solid #0f3460", color: "#a0a0a0", fontSize: "11px", flexShrink: 0 }
            });
            const pageInfo = $el("span", { textContent: "就绪", style: { fontSize: "16px" } });
            const prevBtn = $el("button", { textContent: "◀ 上一页", style: { padding: "9px 18px", borderRadius: "6px", border: "1px solid #e94560", background: "#e94560", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "bold" }, disabled: true });
            const nextBtn = $el("button", { textContent: "下一页 ▶", style: { padding: "9px 18px", borderRadius: "6px", border: "1px solid #e94560", background: "#e94560", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "bold" }, disabled: true });
            // 把翻页按钮移入顶部工具条
            pageToolbar.append(pageStatus, prevBtn, nextBtn);
            container.appendChild(pageToolbar);
            // ── 过滤设置图标 ──
            let blacklistCurrent = "";
            const settingsBtn = $el("button", {
                textContent: "⚙️", title: "过滤设置",
                style: { padding: "5px 10px", borderRadius: "4px", border: "none", background: "#2a2a3a", color: "#aaa", cursor: "pointer", fontSize: "16px", lineHeight: "1.2" }
            });
            let _origResCheck = null;
            settingsBtn.onclick = () => {
                const overlay = $el("div", { style: { position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 } });
                const dialog = $el("div", { style: { background: "#1a1a2e", borderRadius: "8px", padding: "28px", minWidth: "640px", maxWidth: "700px", border: "1px solid #0f3460", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" } });
                const title = $el("div", { textContent: "⚙️ 设置", style: { fontSize: "16px", fontWeight: "bold", color: "#e0e0e0", marginBottom: "14px" } });

                // 过滤标签
                const blLabel = $el("div", { textContent: "输出过滤标签", style: { fontSize: "12px", color: "#aaa", marginBottom: "4px" } });
                const desc = $el("div", { textContent: "逗号/空格分隔，输出的 tag 中不会含这些标签，图片正常显示。", style: { fontSize: "11px", color: "#666", marginBottom: "6px" } });
                const ta = $el("textarea", { style: { width: "100%", height: "80px", padding: "8px", borderRadius: "4px", border: "1px solid #0f3460", background: "#16213e", color: "#e0e0e0", fontSize: "13px", resize: "vertical", boxSizing: "border-box" } });
                // ── 黑名单模糊搜索辅助（文本框下方） ──
                const blInput = $el("input", {
                    type: "text", placeholder: "🔍 搜标签添加到过滤名单（中/英都行）",
                    style: { width: "100%", padding: "8px 10px", marginTop: "6px", borderRadius: "4px", border: "1px solid #e94560", background: "#1a1a2e", color: "#e0e0e0", fontSize: "13px", boxSizing: "border-box", outline: "none" }
                });
                const blList = $el("div", { style: { display: "none", position: "relative", maxHeight: "150px", overflow: "auto", background: "#1a1a2e", border: "1px solid #0f3460", borderRadius: "4px", marginTop: "2px" } });
                let _blTimer = null;
                blInput.oninput = () => {
                    clearTimeout(_blTimer);
                    const q = blInput.value.trim();
                    if (!q || q.length < 1) { blList.style.display = "none"; return; }
                    _blTimer = setTimeout(async () => {
                        try {
                            const r = await fetch("/danbooru_anima/fuzzy_tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
                            const d = await r.json();
                            blList.innerHTML = "";
                            const items = d.tags || [];
                            if (!items.length) { blList.style.display = "none"; return; }
                            for (const item of items) {
                                const row = $el("div", {
                                    textContent: item.cn ? `${item.tag} (${item.cn})` : item.tag,
                                    style: { padding: "6px 10px", cursor: "pointer", color: "#b0bec5", fontSize: "12px", borderBottom: "1px solid #0f3460" },
                                    onmouseover: () => row.style.background = "#0d2137",
                                    onmouseout: () => row.style.background = "transparent",
                                    onclick: () => {
                                        const existing = ta.value.trim();
                                        ta.value = existing ? existing + ", " + item.tag : item.tag;
                                        blList.style.display = "none";
                                        blInput.value = "";
                                    }
                                });
                                blList.appendChild(row);
                            }
                            blList.style.display = "block";
                        } catch { blList.style.display = "none"; }
                    }, 200);
                };
                document.addEventListener("click", (e) => { if (blList.style.display !== "none" && !blInput.contains(e.target) && !blList.contains(e.target)) blList.style.display = "none"; });

                // 原图输出开关
                const orRow = $el("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", padding: "8px 0", borderTop: "1px solid #0f3460" } });
                const orCheck = $el("input", { type: "checkbox", style: { width: "16px", height: "16px", cursor: "pointer", accentColor: "#e94560" } });
                const orLabel = $el("label", { textContent: "原图输出（关闭则使用 sample 尺寸，加载更快）", style: { fontSize: "13px", color: "#e0e0e0", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" } });
                orLabel.prepend(orCheck);
                orRow.appendChild(orLabel);
                _origResCheck = orCheck;

                // ── 多选模式设置 ──
                const multiRow = $el("div", { style: { marginTop: "12px", padding: "8px 0", borderTop: "1px solid #0f3460" } });
                const multiEnCb = $el("input", { type: "checkbox", style: { margin: "0 4px 0 0", cursor: "pointer" } });
                const multiEnLbl = $el("span", { textContent: "启用多选模式（可勾选多张图一次性输出）", style: { color: "#e0e0e0", fontSize: "12px", cursor: "pointer" } });
                multiEnLbl.prepend(multiEnCb);
                multiRow.appendChild(multiEnLbl);
                // 多选合并子选项（默认隐藏）
                const mergeOpts = $el("div", { style: { display: "none", marginTop: "8px", paddingLeft: "8px" } });
                const mergeTitle = $el("div", { textContent: "多选合并设置（去重合并）", style: { color: "#888", fontSize: "11px", marginBottom: "4px" } });
                mergeOpts.appendChild(mergeTitle);
                const _mergeCbs = {};
                const mergeCats = [
                    { key: "artist", label: "画师标签合并" },
                    { key: "character", label: "角色标签合并" },
                    { key: "series", label: "系列标签合并" },
                    { key: "all", label: "全部标签合并" },
                    { key: "quality_meta", label: "质量/元标签合并" },
                    { key: "count", label: "计数标签合并" },
                    { key: "general", label: "通用标签合并" },
                ];
                for (const { key, label } of mergeCats) {
                    const cb = $el("input", { type: "checkbox", style: { margin: "0 4px 0 0", cursor: "pointer" } });
                    const lbl = $el("span", { textContent: label, style: { color: "#ccc", fontSize: "11px", cursor: "pointer" } });
                    lbl.prepend(cb);
                    const row = $el("div", { style: { margin: "2px 0" } });
                    row.appendChild(lbl);
                    mergeOpts.appendChild(row);
                    _mergeCbs[key] = cb;
                }
                const clearFusionWidget = () => {
                    if (fusionWidget) { fusionWidget.value = ""; node.isChanged = true; }
                };
                multiEnCb.onchange = () => {
                    mergeOpts.style.display = multiEnCb.checked ? "block" : "none";
                    if (multiEnCb.checked) { fusionCb.checked = false; clearFusionWidget(); refreshFusionBar(); }
                };
                multiRow.appendChild(mergeOpts);

                // ── 分序号模式（标签融合） ──
                const fusionRow = $el("div", { style: { marginTop: "8px", padding: "6px 0", borderTop: "1px solid #0f3460" } });
                const fusionCb = $el("input", { type: "checkbox", style: { margin: "0 4px 0 0", cursor: "pointer" } });
                const fusionLbl = $el("span", { textContent: "分序号模式（标签融合）", style: { color: "#e0e0e0", fontSize: "12px", cursor: "pointer" } });
                fusionLbl.prepend(fusionCb);
                fusionRow.appendChild(fusionLbl);
                const fusionHint = $el("div", { textContent: "1号=质量/计数/通用 · 2号=角色/系列 · 3号=画师", style: { color: "#888", fontSize: "10px", marginTop: "2px", marginLeft: "16px" } });
                fusionRow.appendChild(fusionHint);
                fusionCb.onchange = () => {
                    if (fusionCb.checked) { multiEnCb.checked = false; mergeOpts.style.display = "none"; }
                    else { clearFusionWidget(); }
                };

                // 从 node_settings 加载节点独立设置（多选、原图输出）
                try {
                    const ns = JSON.parse(nodeSettingsWidget?.value || "{}");
                    // 恢复多选、原图
                    multiEnCb.checked = ns.multi_select_enabled ?? false;
                    orCheck.checked = ns.original_resolution ?? true;
                    fusionCb.checked = ns.tag_fusion_enabled ?? false;
                    // 恢复合并选项：有保存值用保存值，没有保存值全部默认 true
                    for (const k of Object.keys(_mergeCbs)) {
                        const key = "multi_merge_" + k;
                        _mergeCbs[k].checked = ns[key] !== undefined ? ns[key] : true;
                    }
                    mergeOpts.style.display = multiEnCb.checked ? "block" : "none";
                } catch {}
                fetch('/danbooru_anima/settings').then(r => r.json()).then(d => {
                    if (d.success) {
                        ta.value = d.settings?.blacklist_tags || "";
// 深度翻译设置已移除
                    }
                }).catch(() => {});

                const btnRow = $el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" } });
                const cancelBtn = $el("button", { textContent: "取消", style: { padding: "6px 16px", borderRadius: "4px", border: "1px solid #555", background: "#2a2a3a", color: "#ccc", cursor: "pointer", fontSize: "13px" } });
                cancelBtn.onclick = () => overlay.remove();
                const saveBtn = $el("button", { textContent: "保存", style: { padding: "6px 16px", borderRadius: "4px", border: "none", background: "#e94560", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "bold" } });
                saveBtn.onclick = async () => {
                    // 先关弹窗
                    overlay.remove();
                    // 节点独立设置 → 写入 node_settings widget
                    for (const k of Object.keys(_multiMerge)) {
                        _multiMerge[k] = _mergeCbs[k]?.checked ?? false;
                    }
                    const ri = () => { pageInfo.textContent = "就绪"; infoBar.style.display = "none"; };
                    const rmFusionDOM = () => { gridContainer.querySelectorAll(".db-fusion-badge").forEach(b => b.remove()); };
                    const rmMultiDOM = () => { 
                        gridContainer.querySelectorAll(".db-multi-cb").forEach(cb => { cb.textContent = "☐"; cb.style.display = "none"; });
                        gridContainer.querySelectorAll(".db-sel-overlay").forEach(o => o.style.display = "none");
                        gridContainer.querySelectorAll("[style*='border']").forEach(c => { if (c.style && c.style.border && c.style.border !== "none") c.style.border = ""; });
                    };
                    // 三选一（先清所有残留框再设新模式）
                    rmMultiDOM(); rmFusionDOM();
                    if (multiEnCb.checked) {
                        _multiEnabled = true; _tagFusionEnabled = false; fusionCb.checked = false;
                        _fusionSlots = { 1: new Set(), 2: new Set(), 3: new Set() };
                        clearFusionWidget();
                        toggleMultiCbs(true);
                        ri(); refreshFusionBar();
                    } else if (fusionCb.checked) {
                        _tagFusionEnabled = true; _multiEnabled = false; multiEnCb.checked = false; mergeOpts.style.display = "none";
                        _multiSelections.clear(); if (selWidget) selWidget.value = "{}";
                        toggleMultiCbs(false);
                        ri(); refreshFusionBar();
                    } else {
                        _multiEnabled = false; _tagFusionEnabled = false;
                        _multiSelections.clear(); _fusionSlots = { 1: new Set(), 2: new Set(), 3: new Set() };
                        if (selWidget) selWidget.value = "{}";
                        clearFusionWidget();
                        toggleMultiCbs(false);
                        ri(); refreshFusionBar();
                    }
                    saveNodeSettings();
                    // 全局设置 → POST 到后端（后台发，不影响关闭）
                    try {
                        const resp = await fetch('/danbooru_anima/settings', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                blacklist_tags: ta.value.trim(),
// 深度翻译设置已移除
                            })
                        });
                        const d = await resp.json();
                        if (d.success) {
                            blacklistCurrent = ta.value.trim();
                            _multiEnabled = multiEnCb.checked;
                            toggleMultiCbs(_multiEnabled);
                            for (const k of Object.keys(_multiMerge)) {
                                _multiMerge[k] = _mergeCbs[k]?.checked ?? false;
                            }
                            // 先刷新 widget 再清空（否则已选列表空了）
                            if (_multiEnabled && _multiSelections.size > 0) {
                                const sels = [..._multiSelections].map(id => ({ post_id: id }));
                                const pl = JSON.stringify({ selections: sels, merge: _multiMerge, image_connected: imageConnected() });
                                if (selWidget) selWidget.value = pl;
                                node.isChanged = true;
                            }
                            if (!_multiEnabled) _multiSelections.clear();
                            overlay.remove();
                        }
                    } catch {}
                };
                const buildTableBtn = $el("button", { textContent: "📊 生成完整分类表", title: "从 D 站 API 拉取全部 tag group，补充 tag_groups.json", style: { padding: "5px 10px", borderRadius: "4px", border: "1px solid #6bcb77", background: "#1a1a2e", color: "#6bcb77", cursor: "pointer", fontSize: "12px", marginRight: "4px" } });
                buildTableBtn.onclick = async () => {
                    buildTableBtn.textContent = "⏳ 启动中...";
                    buildTableBtn.disabled = true;
                    await fetch("/danbooru_anima/build_tag_table");
                    const pi = setInterval(async () => {
                        try {
                            const pr = await fetch("/danbooru_anima/build_tag_table_progress");
                            const pd = await pr.json();
                            if (pd.result) {
                                clearInterval(pi);
                                const d = pd.result;
                                if (d.success) buildTableBtn.textContent = `✅ 新增 ${d['新增']} 条，共 ${d['总数']} 条`;
                                else buildTableBtn.textContent = "❌ " + (d.error || "失败");
                                buildTableBtn.disabled = false;
                            } else {
                                buildTableBtn.textContent = `⏳ ${pd.done_groups}/${pd.total_groups} ${pd.current}`;
                            }
                        } catch {}
                    }, 500);
                };
                const refreshBtn = $el("button", { textContent: "🔄 更新中文索引", title: "从 D 站画廊同步最新中文数据", style: { padding: "5px 10px", borderRadius: "4px", border: "1px solid #0f3460", background: "#1a1a2e", color: "#e0e0e0", cursor: "pointer", fontSize: "12px", marginRight: "auto" } });
                refreshBtn.onclick = async () => {
                    refreshBtn.textContent = "⏳ 更新中...";
                    refreshBtn.disabled = true;
                    try {
                        const r = await fetch('/danbooru_anima/refresh_index');
                        const d = await r.json();
                        if (d.success) refreshBtn.textContent = `✅ ${d.entries} 词条 · ${d.tags} 标签`;
                        else refreshBtn.textContent = "❌ 更新失败";
                    } catch { refreshBtn.textContent = "❌ 更新失败"; }
                    setTimeout(() => { refreshBtn.textContent = "🔄 更新中文索引"; refreshBtn.disabled = false; }, 3000);
                };
                const btnBase = (bg, label, svg) => {
                    const a = document.createElement("a");
                    a.href = "#"; a.target = "_blank";
                    a.title = label;
                    a.style.cssText = `padding:5px 10px;border-radius:4px;border:none;background:${bg};color:#fff;cursor:pointer;font-size:13px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;`;
                    a.innerHTML = svg + `<span>${label}</span>`;
                    return a;
                };
                const biliSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M3 10h18"/><rect x="8" y="11" width="3" height="3" rx="1"/><rect x="13" y="11" width="3" height="3" rx="1"/><path d="M8 7L10 3h4l2 4"/></svg>`;
                const ytSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white"><rect x="2" y="4" width="20" height="16" rx="4"/><path d="M10 8v8l6-4z" fill="#ff0000"/></svg>`;
                const caiSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white"><circle cx="12" cy="12" r="10" fill="none" stroke="white" stroke-width="2"/><path d="M16 8A6 6 0 1 0 16 16" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"/></svg>`;
                const rhSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="white" stroke-width="2"/><text x="12" y="17" font-size="14" text-anchor="middle" fill="white" font-weight="bold" font-family="sans-serif">RH</text></svg>`;

                const biliBtn = btnBase("#fb7299", "B站", biliSvg);
                biliBtn.href = "https://space.bilibili.com/169318349"; biliBtn.title = "作者B站主页";

                const ytBtn = btnBase("#ff0000", "YouTube", ytSvg);
                ytBtn.href = "https://www.youtube.com/@Zove-try"; ytBtn.title = "作者YouTube主页";

                const caiBtn = btnBase("#0abf53", "CivitAI", caiSvg);
                caiBtn.href = "https://civitai.com/user/Zovetry"; caiBtn.title = "作者CivitAI主页";

                // ── RunningHub 合并按钮：点击弹出选 .ai 还是 .cn ──
                const rhBtn = btnBase("#2563eb", "RH", rhSvg);
                rhBtn.title = "选择RunningHub站点";
                const rhDropdown = $el("div", {
                    style: { position: "absolute", top: "100%", left: "0", zIndex: 10000,
                             background: "#1a1a2e", border: "1px solid #0f3460", borderRadius: "4px",
                             display: "none", minWidth: "120px", marginTop: "2px" }
                });
                rhBtn.style.position = "relative";
                for (const { domain, url } of [
                    { domain: "国际站", url: "https://www.runninghub.ai/user-center/1898017693566418945/webapp?inviteCode=rh-v1315" },
                    { domain: "中国站", url: "https://www.runninghub.cn/user-center/1898017693566418945/webapp?inviteCode=rh-v1315" },
                ]) {
                    const item = $el("div", {
                        textContent: domain,
                        style: { padding: "6px 12px", cursor: "pointer", color: "#e0e0e0", fontSize: "12px" },
                        onmouseover: () => { item.style.background = "#0f3460"; },
                        onmouseout: () => { item.style.background = "transparent"; },
                        onclick: (e) => { e.stopPropagation(); window.open(url, "_blank"); rhDropdown.style.display = "none"; }
                    });
                    rhDropdown.appendChild(item);
                }
                rhBtn.onclick = (e) => { e.preventDefault(); rhDropdown.style.display = rhDropdown.style.display === "none" ? "block" : "none"; };
                document.addEventListener("click", (e) => { if (!rhBtn.contains(e.target)) rhDropdown.style.display = "none"; });
                rhBtn.appendChild(rhDropdown);

                const socBar = $el("div", { style: { display: "flex", gap: "4px", marginRight: "auto" } });
                socBar.append(biliBtn, ytBtn, caiBtn, rhBtn);
                btnRow.append(socBar, buildTableBtn, refreshBtn, cancelBtn, saveBtn);
                dialog.append(title, blLabel, desc, ta, blInput, blList, orRow, multiRow, fusionRow, btnRow);
                overlay.append(dialog);
                // 点遮罩不关闭，避免误触丢失未保存的设置
                // overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
                document.body.appendChild(overlay);
            };
            searchBar.appendChild(settingsBtn);
            footer.appendChild(pageInfo);
            container.appendChild(footer);

            // ──── 搜索 ────
            const clearMultiSel = () => {
                _multiSelections.clear();
                if (selWidget) selWidget.value = "{}";
                document.querySelectorAll(".db-multi-cb").forEach(cb => { cb.textContent = "☐"; });
                document.querySelectorAll(".db-sel-overlay").forEach(o => { o.style.display = "none"; });
            };
            let _currentForceTags = null;
            const doSearch = async (page = 1, forceTags = null) => {
                if (_multiEnabled) clearMultiSel();
                if (forceTags !== null) _currentForceTags = forceTags;
                else if (!page || page === 1) {
                    if (!_hotActive) _currentForceTags = null;  // 非热门模式才清空
                }
                let query = _currentForceTags !== null ? _currentForceTags : searchInput.value.trim();
                const ratingStr = _ratAll.checked ? "" : [..._activeRatings].join(",");
                isLoading = true;
                gridContainer.innerHTML = '<div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;padding:60px 0;color:#e0e0e0;font-size:18px;">⏳ 搜索中...</div>';
                searchBtn.textContent = "⏳";
                try {
                    const resp = await fetch("/danbooru_anima/search", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tags: query, page, limit: 12, rating: ratingStr }),
                    });
                    const data = await resp.json();
                    if (data.success && data.posts) {
                        currentPosts = data.posts;
                        currentPage = page;
                        // 直接渲染所有卡片，图片自然逐张加载
                        renderGrid(data.posts);
                        // 存储翻译
                        for (const p of data.posts) {
                            if (p.classified) tagCache[p.id] = p.classified;
                            if (p.translations) {
                                tagTranslationCache[p.id] = p.translations;
                                Object.assign(_globalTagTranslations, p.translations);
                            }
                        }
                        // tag 数据已从搜索结果中嵌入，无需额外预加载
                        prevBtn.disabled = page <= 1;
                        nextBtn.disabled = data.posts.length < 12;
                        pageStatus.textContent = `第${page}页·${data.posts.length}条`;
                    } else {
                        gridContainer.innerHTML = `<div style="color:#e94560;padding:30px;text-align:center;grid-column:1/-1;">搜索失败</div>`;
                    }
                } catch (err) {
                    gridContainer.innerHTML = `<div style="color:#e94560;padding:30px;text-align:center;grid-column:1/-1;">${err.message}</div>`;
                } finally {
                    isLoading = false;
                    searchBtn.textContent = "🔍";
                }
            };

            // ── 分类搜索弹窗（搜角色/系列/画师，带中文翻译） ──
            let _clsPopup = null;
            const _cnTag = (tag) => {
                const cn = tagTranslations[tag] || _globalTagTranslations[tag];
                return cn ? `${tag} (${cn})` : tag;
            };
            const _favCatMap = { character: "characters", series: "series", artist: "artists" };
            const showClassSearch = (postId, cdata, anchor, translations) => {
                if (_clsPopup) { _clsPopup.remove(); _clsPopup = null; }
                if (!_favCache) _getFavs();
                // 更新 tagTranslations
                if (translations) {
                    Object.assign(tagTranslations, translations);
                    Object.assign(_globalTagTranslations, translations);
                    if (!tagTranslationCache[postId]) tagTranslationCache[postId] = {};
                    Object.assign(tagTranslationCache[postId], translations);
                }
                const doSearchTag = (tag) => {
                    searchInput.value = tag.replace(/ /g, '_');
                    if (_clsPopup) _clsPopup.remove();
                    _clsPopup = null;
                    if (_hotActive) { _hotActive = false; Object.assign(hotBtn.style, _DEF_STYLE); _currentForceTags = null; }
                    doSearch(1);
                };
                const _makeStar = (tag, favCat) => {
                    const isFav = _favCache?.[favCat]?.[tag];
                    const star = $el("span", {
                        textContent: isFav ? "★" : "☆",
                        title: isFav ? "取消收藏" : "收藏",
                        style: { cursor: "pointer", fontSize: "14px", marginLeft: "4px", color: isFav ? "#ffd93d" : "#666" },
                        onclick: async (ev) => {
                            ev.stopPropagation();
                            star.textContent = "⏳";
                            const cn = tagTranslations[tag] || _globalTagTranslations[tag] || "";
                            const result = await _toggleFav(tag, favCat, _lastThumbUrl || "", cn);
                            star.textContent = result === "added" ? "★" : "☆";
                            star.title = result === "added" ? "取消收藏" : "收藏";
                            star.style.color = result === "added" ? "#ffd93d" : "#666";
                        }
                    });
                    return star;
                };
                const buildSubList = (tags, favCat) => {
                    const box = $el("div", { style: { borderTop: "1px solid #0f3460" } });
                    for (const tag of tags) {
                        const row = $el("div", {
                            style: { padding: "6px 14px 6px 24px", cursor: "pointer", color: "#b0bec5", fontSize: "12px", display: "flex", alignItems: "center" },
                            onmouseover: () => { row.style.background = "#0d2137"; },
                            onmouseout: () => { row.style.background = "transparent"; },
                            onclick: (ev) => { ev.stopPropagation(); doSearchTag(tag); }
                        });
                        row.innerHTML = `<span style="flex:1">${_cnTag(tag)}</span>`;
                        row.appendChild(_makeStar(tag, favCat));
                        box.appendChild(row);
                    }
                    return box;
                };

                // 计算弹窗位置：在卡片正上方
                const rect = anchor.getBoundingClientRect();
                const topPos = rect.top - 10;  // 卡片上方 10px
                const leftPos = Math.max(8, Math.min(rect.left + rect.width / 2 - 90, window.innerWidth - 188));

                const popup = $el("div", {
                    style: { position: "fixed", top: `${topPos}px`, left: `${leftPos}px`,
                             background: "#16213e", border: "1px solid #0f3460", borderRadius: "8px",
                             minWidth: "180px", zIndex: 10000, boxShadow: "0 6px 24px rgba(0,0,0,0.7)", overflow: "hidden" }
                });

                const cats = [
                    { key: "character", label: "搜角色", icon: "👤", color: "#f48fb1" },
                    { key: "series",    label: "搜系列", icon: "📺", color: "#ce93d8" },
                    { key: "artist",    label: "搜画师", icon: "🎨", color: "#81d4fa" },
                ];
                for (const { key, label, icon, color } of cats) {
                    const tags = (cdata[key] || []).slice(0, 8);
                    if (tags.length === 0) continue;
                    const favCat = _favCatMap[key] || "general";
                    if (tags.length === 1) {
                        const row = $el("div", {
                            style: { display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", cursor: "pointer", borderBottom: "1px solid #0f3460" },
                            onmouseover: () => { row.style.background = "#0d2137"; },
                            onmouseout: () => { row.style.background = "transparent"; },
                            onclick: (ev) => { ev.stopPropagation(); doSearchTag(tags[0]); }
                        });
                        row.innerHTML = `<span style="font-size:15px">${icon}</span><span style="color:#e0e0e0;font-size:13px">${label}</span><span style="margin-left:auto;color:${color};font-size:12px">${_cnTag(tags[0])}</span>`;
                        row.appendChild(_makeStar(tags[0], favCat));
                        popup.appendChild(row);
                    } else {
                        const row = $el("div", {
                            style: { display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", cursor: "pointer", borderBottom: "1px solid #0f3460" },
                            onmouseover: () => { row.style.background = "#0d2137"; },
                            onmouseout: () => { row.style.background = "transparent"; },
                            onclick: (ev) => {
                                ev.stopPropagation();
                                const existing = row.nextElementSibling;
                                if (existing && existing._subList) { existing.remove(); }
                                else {
                                    const sub = buildSubList(tags, favCat);
                                    sub._subList = true;
                                    row.after(sub);
                                }
                            }
                        });
                        row.innerHTML = `<span style="font-size:15px">${icon}</span><span style="color:#e0e0e0;font-size:13px">${label}</span><span style="margin-left:auto;color:${color};font-size:12px">${tags.length}个 ▾</span>`;
                        popup.appendChild(row);
                    }
                }

                document.body.appendChild(popup);
                _clsPopup = popup;
                setTimeout(() => {
                    const closer = (ev) => {
                        if (!popup.contains(ev.target)) {
                            popup.remove(); _clsPopup = null; document.removeEventListener('click', closer);
                        }
                    };
                    document.addEventListener('click', closer);
                }, 10);
            };

            // ──── 渲染网格 ────
            const renderGrid = (posts) => {
                gridContainer.innerHTML = "";
                if (!posts || posts.length === 0) {
                    gridContainer.innerHTML = '<div style="color:#a0a0a0;padding:30px;text-align:center;grid-column:1/-1;">没有结果</div>';
                    return;
                }
                for (const post of posts) {
                    const ratio = post.height && post.width ? (post.height / post.width * 100) : 100;
                    const card = $el("div", {
                        style: {
                            position: "relative", borderRadius: "3px", overflow: "hidden",
                            cursor: "pointer",
                            border: "none",
                            paddingBottom: `${ratio}%`,
                            background: "#16213e",
                        }
                    });
                    card._postId = post.id;
                    card.dataset.postid = post.id;

                    const img = $el("img", {
                        src: `/danbooru_anima/image_proxy?url=${encodeURIComponent(post.preview_url || "")}`,
                        "data-large-url": post.large_url || "",
                        style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#16213e" },
                    });

                    // 视频标记
                    const videoBadge = post.is_video ? $el("span", {
                        textContent: "🎬 VIDEO",
                        style: { position: "absolute", top: "3px", left: "3px", background: "rgba(0,0,0,0.8)", color: "#ff6b6b", padding: "2px 6px", borderRadius: "3px", fontSize: "16px", fontWeight: "bold", zIndex: 2 }
                    }) : null;
                    const scoreBadge = $el("span", {
                        textContent: `★${post.score ?? 0}`,
                        style: { position: "absolute", top: "3px", right: "3px", background: "rgba(0,0,0,0.8)", color: "#ffd700", padding: "2px 6px", borderRadius: "3px", fontSize: "16px", fontWeight: "bold" }
                    });
                    const rc = { s: "#4caf50", q: "#ff9800", e: "#e94560" };
                    const rb = $el("span", {
                        textContent: (post.rating || "?").toUpperCase(),
                        style: { position: "absolute", bottom: "3px", right: "3px", background: rc[post.rating] || "#888", color: "#fff", padding: "1px 5px", borderRadius: "3px", fontSize: "16px", fontWeight: "bold" }
                    });
                    const tagBtn = $el("span", {
                        textContent: "📋 TAGS",
                        title: "查看标签",
                        style: { position: "absolute", top: "3px", left: post.is_video ? "95px" : "3px", background: "rgba(233,69,96,0.85)", color: "#fff", padding: "5px 11px", borderRadius: "6px", fontSize: "22px", fontWeight: "bold", cursor: "pointer", zIndex: 3, lineHeight: "1.5", backdropFilter: "blur(2px)", border: "1px solid rgba(233,69,96,0.3)" }
                    });
                    tagBtn.onclick = (e) => {
                        e.stopPropagation();
                        // 优先用 post.preview_url（API 返回的原始 URL）
                        let url = (post.large_url || post.preview_url || '').trim();
                        // 如果 post 没有，再从 DOM img 元素提取
                        if (!url) {
                            const cardImg = e.currentTarget.parentElement.querySelector('img');
                            if (cardImg) {
                                try {
                                    const raw = cardImg.getAttribute('src') || cardImg.src || '';
                                    url = decodeURIComponent(new URL(raw, location.origin).searchParams.get('url') || '');
                                } catch {}
                            }
                        }
                        _lastThumbUrl = url;
                        showTagOverlay(post.id);
                    };

                    // ── 分类搜索按钮（🔍 搜角色/系列/画师） ──
                    const clsBtn = $el("span", {
                        textContent: "🔍",
                        title: "搜角色/系列/画师",
                        style: { position: "absolute", top: "34px", right: "3px", background: "rgba(0,0,0,0.75)", color: "#4fc3f7", padding: "5px 11px", borderRadius: "6px", fontSize: "22px", cursor: "pointer", zIndex: 3, lineHeight: "1.5", backdropFilter: "blur(2px)", border: "1px solid rgba(79,195,247,0.3)" }
                    });
                    clsBtn.onclick = (e) => {
                        e.stopPropagation();
                        // 记录缩略图供 ☆ 收藏用
                        let url = (post.large_url || post.preview_url || '').trim();
                        if (!url) {
                            const ci = e.currentTarget.parentElement.querySelector('img');
                            if (ci) {
                                try { url = decodeURIComponent(new URL(ci.getAttribute('src') || ci.src || '', location.origin).searchParams.get('url') || ''); } catch {}
                            }
                        }
                        _lastThumbUrl = url;
                        const cdata = tagCache[post.id];
                        if (cdata) {
                            const trans = tagTranslationCache[post.id] || {};
                            showClassSearch(post.id, cdata, card, trans);
                        } else {
                            // 从预加载队列中抢走这个 post，避免重复请求
                            if (_preloadQueue) _preloadQueue.delete(post.id);
                            clsBtn.textContent = "⏳";
                            fetch(`/danbooru_anima/post/${post.id}`).then(r => r.json()).then(d => {
                                clsBtn.textContent = "🔍";
                                if (d.success && d.classified) {
                                    tagCache[post.id] = d.classified;
                                    showClassSearch(post.id, d.classified, card, d.translations || {});
                                }
                            }).catch(() => { clsBtn.textContent = "🔍"; });
                        }
                    };

                    const _isMultiSel = _multiSelections.has(post.id);
                    // 多选勾选框（始终显示，切换模式时可见）
                    const multiCb = $el("span", {
                        className: "db-multi-cb",
                        textContent: _isMultiSel ? "☑" : "☐",
                        style: { position: "absolute", top: "24px", left: "3px", background: "rgba(0,0,0,0.7)", color: _isMultiSel ? "#ffd93d" : "#4fc3f7", padding: "1px 6px", borderRadius: "4px", fontSize: "14px", fontWeight: "bold", zIndex: 4, cursor: "pointer", display: _multiEnabled ? "block" : "none" }
                    });
                    // ── ❤️ 图片收藏按钮（左下角） ──
                    const _imgIsFav = _favCache?.images?.[String(post.id)];
                    const favImgBtn = $el("span", {
                        textContent: _imgIsFav ? "❤️" : "🤍",
                        title: _imgIsFav ? "取消收藏图片" : "收藏图片",
                        style: {
                            position: "absolute", bottom: "3px", left: "3px",
                            background: "rgba(0,0,0,0.75)", color: "#e94560",
                            padding: "5px 11px", borderRadius: "6px",
                            fontSize: "22px", cursor: "pointer", zIndex: 3,
                            lineHeight: "1.5", backdropFilter: "blur(2px)",
                            border: _imgIsFav ? "1px solid #e94560" : "1px solid transparent"
                        },
                        onclick: async (e) => {
                            e.stopPropagation();
                            const key = String(post.id);
                            const isFav = _favCache?.images?.[key];
                            // 立即显示加载动画，提示用户已响应
                            favImgBtn.textContent = "⏳";
                            if (isFav) {
                                await fetch('/danbooru_anima/favorites/remove', {
                                    method: 'POST', headers: {'Content-Type':'application/json'},
                                    body: JSON.stringify({ tag: key, category: 'images' })
                                });
                                if (_favCache?.images) delete _favCache.images[key];
                                favImgBtn.textContent = "🤍";
                                favImgBtn.title = "收藏图片";
                                favImgBtn.style.border = "1px solid transparent";
                            } else {
                                const tagsStr = post.tags || post.tag_string || '';
                                const meta = JSON.stringify({ tags: tagsStr, large_url: post.large_url || post.file_url || '' });
                                await fetch('/danbooru_anima/favorites/add', {
                                    method: 'POST', headers: {'Content-Type':'application/json'},
                                    body: JSON.stringify({ tag: key, category: 'images', thumb_url: post.preview_url || '', cn: meta })
                                });
                                if (!_favCache.images) _favCache.images = { _order: [] };
                                _favCache.images[key] = { thumb: post.preview_url || '', cn: meta };
                                if (_favCache.images._order) _favCache.images._order.push(key);
                                else _favCache.images._order = [key];
                                favImgBtn.textContent = "❤️";
                                favImgBtn.title = "取消收藏图片";
                                favImgBtn.style.border = "1px solid #e94560";
                            }
                        }
                    });
                    multiCb.onclick = (e) => { e.stopPropagation(); selectPost(post, card); };

                    card.append(img, scoreBadge, clsBtn, tagBtn, multiCb, rb, favImgBtn);
                    if (videoBadge) card.append(videoBadge);
                    // 如果图片已在多选列表，应用选中样式
                    if (_isMultiSel) {
                        card.style.border = "2px solid #4fc3f7";
                        const ov = $el("div", { className: "db-sel-overlay", style: { position: "absolute", inset: 0, background: "rgba(79,195,247,0.12)", pointerEvents: "none", borderRadius: "3px" } });
                        card.appendChild(ov);
                    }
                    card.onclick = () => selectPost(post, card);
                    gridContainer.appendChild(card);
                }
                // 渲染完后主动预加载高分图的 tag
                setTimeout(() => prefetchTags(posts), 100);
            };

            // ──── 预加载：只提前载前 3 张高分图的 tag，避免阻塞 Run ────
            const prefetchTags = (posts) => {
                const sorted = [...posts].sort((a, b) => (b.score || 0) - (a.score || 0));
                let count = 0;
                for (const post of sorted) {
                    if (count >= 3) break;
                    if (tagCache[post.id]) continue;
                    count++;
                    fetch(`/danbooru_anima/post/${post.id}`)
                        .then(r => r.json())
                        .then(data => {
                            if (data.success && data.classified) {
                                tagCache[post.id] = data.classified;
                                if (data.translations) tagTranslationCache[post.id] = data.translations;
                            }
                        })
                        .catch(() => {});
                }
            };

            // ── 多选：切换所有卡片勾选框的显示 ──
            const toggleMultiCbs = (show) => {
                document.querySelectorAll(".db-multi-cb").forEach(cb => { cb.style.display = show ? "block" : "none"; });
            };

            // ── 检测 IMAGE 端口（index=0）是否接线 ──
            const imageConnected = () => node?.outputs?.[0]?.links?.length > 0;

            // ──── 选中帖子（点击瞬间写 widget，不等 API） ────
            const selectPost = async (post, card) => {
                if (_tagFusionEnabled) {
                    // ── 分序号模式 ──
                    const slot = _fusionActiveSlot;
                    const s = _fusionSlots[slot];
                    // 检查所有序号
                    const inSlots = [];
                    for (const n of [1, 2, 3]) {
                        if (_fusionSlots[n].has(post.id)) inSlots.push(n);
                    }
                    if (s.has(post.id)) {
                        s.delete(post.id);
                        if (_sync12 && slot === 1) _fusionSlots[2].delete(post.id);
                    } else {
                        s.add(post.id);
                        inSlots.push(slot);
                        if (_sync12 && slot === 1) { _fusionSlots[2].add(post.id); inSlots.push(2); }
                    }
                    // 刷新角标
                    let badge = card.querySelector(".db-fusion-badge");
                    if (!badge) {
                        badge = $el("div", { className: "db-fusion-badge", style: { position: "absolute", bottom: "4px", left: "4px", zIndex: 6, display: "flex", gap: "3px" } });
                        card.appendChild(badge);
                    }
                    const slotLabels = { 1: "1", 2: "2", 3: "3" };
                    const slotBg = { 1: "#4fc3f7", 2: "#e94560", 3: "#6bcb77" };
                    const nowInSlots = [];
                    for (const n of [1, 2, 3]) {
                        if (_fusionSlots[n].has(post.id)) nowInSlots.push(n);
                    }
                    if (nowInSlots.length === 0) {
                        badge.style.display = "none";
                        card.style.border = "2px solid transparent";
                        const ov = card.querySelector(".db-sel-overlay");
                        if (ov) ov.style.display = "none";
                    } else {
                        badge.style.display = "flex";
                        badge.innerHTML = nowInSlots.map(n => `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:${slotBg[n]};color:#1a1a2e;font-size:11px;font-weight:bold;">${slotLabels[n]}</span>`).join("");
                        // 边框用最新添加的序号颜色
                        const lastSlot = nowInSlots[nowInSlots.length - 1];
                        card.style.border = "2px solid " + (slotBg[lastSlot] || "#4fc3f7");
                        let ov = card.querySelector(".db-sel-overlay");
                        if (!ov) {
                            ov = $el("div", { className: "db-sel-overlay", style: { position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "3px" } });
                            card.appendChild(ov);
                        }
                        ov.style.display = "block";
                        // 多序号时用渐变色背景
                        if (nowInSlots.length === 1) {
                            const colors = { 1: "rgba(79,195,247,0.15)", 2: "rgba(233,69,96,0.15)", 3: "rgba(107,203,119,0.15)" };
                            ov.style.background = colors[nowInSlots[0]] || "rgba(79,195,247,0.12)";
                        } else {
                            ov.style.background = "rgba(255,255,255,0.06)";
                        }
                    }
                    refreshFusionBar();
                    return;
                }
                if (_multiEnabled) {
                    // ── 多选模式：切换勾选 ──
                    if (_multiSelections.has(post.id)) {
                        _multiSelections.delete(post.id);
                        card.style.border = "2px solid transparent";
                        const ov = card.querySelector(".db-sel-overlay");
                        if (ov) ov.style.display = "none";
                        const cb = card.querySelector(".db-multi-cb");
                        if (cb) cb.textContent = "☐";
                    } else {
                        _multiSelections.add(post.id);
                        card.style.border = "2px solid #4fc3f7";
                        let ov = card.querySelector(".db-sel-overlay");
                        if (!ov) {
                            ov = $el("div", { className: "db-sel-overlay", style: { position: "absolute", inset: 0, background: "rgba(79,195,247,0.12)", pointerEvents: "none", borderRadius: "3px" } });
                            card.appendChild(ov);
                        }
                        ov.style.display = "block";
                        const cb = card.querySelector(".db-multi-cb");
                        if (cb) cb.textContent = "☑";
                    }
                    // 写出多选格式到 widget
                    const selections = [..._multiSelections].map(id => ({ post_id: id }));
                    const payload = JSON.stringify({ selections, merge: _multiMerge, image_connected: imageConnected() });
                    if (selWidget) selWidget.value = payload;
                    node.isChanged = true;

                    const cnt = _multiSelections.size;
                    pageInfo.textContent = cnt ? `📦 已选 ${cnt} 张` : "就绪";
                    if (cnt) {
                        infoBar.style.display = "block";
                        infoBar.innerHTML = `已选 ${cnt} 张，Run 后输出 <span class="db-clear-multi" style="color:#e94560;cursor:pointer;font-weight:bold;margin-left:10px;">✕ 清空</span>`;
                        infoBar.querySelector(".db-clear-multi").onclick = () => {
                            _multiSelections.clear();
                            if (selWidget) selWidget.value = "{}";
                            node.isChanged = true;
                            document.querySelectorAll(".db-multi-cb").forEach(cb => { cb.textContent = "☐"; });
                            document.querySelectorAll(".db-sel-overlay").forEach(o => o.style.display = "none");
                            infoBar.style.display = "none";
                            pageInfo.textContent = "就绪";
                        };
                    } else { infoBar.style.display = "none"; }
                    return;
                }

                // ── 单选模式 ──
                if (selectedPostId === post.id) {
                    // 已选中 → 取消选择
                    selectedPostId = null;
                    const payload = JSON.stringify({ post_id: null, image_connected: imageConnected(), deselected: true });
                    if (selWidget) selWidget.value = payload;
                    node.isChanged = true;
                    card.style.border = "2px solid transparent";
                    const ov = card.querySelector(".db-sel-overlay");
                    if (ov) ov.style.display = "none";
                    pageInfo.textContent = "就绪";
                    return;
                }
                selectedPostId = post.id;
                const payload = JSON.stringify({ post_id: post.id, image_connected: imageConnected() });
                if (selWidget) selWidget.value = payload;
                node.isChanged = true;

                for (const ch of gridContainer.children) {
                    ch.style.border = "2px solid transparent";
                    const ov = ch.querySelector(".db-sel-overlay");
                    if (ov) ov.style.display = "none";
                    const cb = ch.querySelector(".db-multi-cb");
                    if (cb) cb.textContent = "☐";
                }
                card.style.border = "3px solid #e94560";
                let ov2 = card.querySelector(".db-sel-overlay");
                if (!ov2) {
                    ov2 = $el("div", { className: "db-sel-overlay", style: { position: "absolute", inset: 0, background: "rgba(233,69,96,0.15)", pointerEvents: "none", borderRadius: "3px" } });
                    card.appendChild(ov2);
                }
                ov2.style.display = "block";
                infoBar.style.display = "block";

                const cached = tagCache[post.id];
                if (cached) {
                    renderInfoBar(cached);
                    pageInfo.textContent = `✅ 已选 #${post.id} | ${cached.all?.length || 0} tags`;
                    return;
                }

                /* overlay now triggered by tagBtn only */
                pageInfo.textContent = `⏳ 加载 #${post.id} 标签...`;

                try {
                    const resp = await fetch(`/danbooru_anima/post/${post.id}`);
                    const data = await resp.json();
                    if (data.success && data.classified) {
                        tagCache[post.id] = data.classified;
                        pageInfo.textContent = `✅ 已选 #${post.id} | ${data.classified.all?.length || 0} tags`;
                    }
                } catch (err) {
                    infoBar.textContent = `错误: ${err.message}`;
                }
            };

            // ──── 渲染信息栏 ────
            let tagTranslations = {}; let tagTranslationCache = {};
            // ── 语言检测 ──
            const uiLang = (() => {
                try {
                    return window.ComfyUI?.settings?.get?.('language')
                        || window.app?.settings?.get?.('language')
                        || navigator.language || 'en-US';
                } catch { return 'en-US'; }
            })();
            const _L = {
                "QUALITY": { "zh-CN": "质量/元", "ja-JP": "品質/メタ", "ko-KR": "품질/메타" },
                "COUNT": { "zh-CN": "数量", "ja-JP": "数量", "ko-KR": "수량" },
                "CHAR": { "zh-CN": "角色", "ja-JP": "キャラ", "ko-KR": "캐릭터" },
                "SERIES": { "zh-CN": "系列", "ja-JP": "シリーズ", "ko-KR": "시리즈" },
                "ARTIST": { "zh-CN": "画师", "ja-JP": "アーティスト", "ko-KR": "아티스트" },
                "GENERAL": { "zh-CN": "常规", "ja-JP": "一般", "ko-KR": "일반" },
            };
            const ll = (key) => _L[key]?.[uiLang] || _L[key]?.["en-US"] || key;
            const _catKeyForFav = { character: 'characters', artist: 'artists', series: 'series' };
            const _SearchBtn = (tag) => {
                return '<span class="db-tag-srch" data-tag="' + tag + '" style="cursor:pointer;font-size:15px;margin-left:3px;color:#4fc3f7;text-shadow:0 0 4px rgba(0,0,0,0.5);" title="搜索此标签">🔍</span>';
            };
            const _FavStar = (tag, cat) => {
                const isFav = _favCache?.[cat]?.[tag];
                const color = isFav ? '#ffd93d' : '#888';
                return '<span class="db-fav-star" data-tag="' + tag + '" data-cat="' + cat + '" style="cursor:pointer;font-size:18px;margin-left:3px;color:' + color + ';text-shadow:0 0 4px rgba(0,0,0,0.5);" title="' + (isFav ? '取消收藏' : '收藏') + '">' + (isFav ? '★' : '☆') + '</span>';
            };
            // 🔍 搜索按钮事件委派（tag 弹窗中的每个 tag）
            if (!_clickHandlerInstalled) {
                _clickHandlerInstalled = true;
                document.addEventListener("click", (e) => {
                    const srch = e.target.closest(".db-tag-srch");
                    if (!srch) return;
                    e.stopPropagation();
                    const tag = srch.dataset.tag;
                    searchInput.value = tag.replace(/ /g, '_');
                    if (_clsPopup) { _clsPopup.remove(); _clsPopup = null; }
                    if (_hotActive) { _hotActive = false; Object.assign(hotBtn.style, _DEF_STYLE); _currentForceTags = null; }
                    doSearch(1);
                });
            }
            const buildTagHtml = (c) => {
                let html = '<div style="font-size:13px;line-height:2.2;">';
                const L = (label, tags, color, catKey) => {
                    if (tags?.length) {
                        html += '<span style="display:inline-block;background:' + color + '22;color:' + color + ';padding:0 8px;border-radius:4px;margin:3px 0;font-weight:bold;font-size:12px;">' + label + '</span> ';
                        for (const t of tags) {
                            const cn = tagTranslations[t] || _globalTagTranslations[t];
                            const display = cn ? (t + ' <span style="color:#888;">(' + cn + ')</span>') : t;
                            const favCat = _catKeyForFav[catKey] || 'general';
                            html += '<span class="db-tag" style="font-size:13px;display:inline-block;margin:2px 0;">' + display + _SearchBtn(t) + _FavStar(t, favCat) + ' </span>';
                        }
                        html += '<br>';
                    }
                };
                L(ll("QUALITY"), c.quality_meta, "#ff6b6b", 'general');
                L(ll("COUNT"), c.count, "#ffd93d", 'general');
                L(ll("CHAR"), c.character, "#6bcb77", 'character');
                L(ll("SERIES"), c.series, "#4d96ff", 'series');
                L(ll("ARTIST"), c.artist, "#ff6ec7", 'artist');
                L(ll("GENERAL"), c.general, "#a0a0a0", 'general');
                html += '</div>';
                return html || '<span style="color:#888;">（无标签）</span>';
            };
            const renderInfoBar = (c) => {
                infoBar.innerHTML = ""; // just clear, HTML not shown here anymore
            };

            // ──── 事件绑定 ────
            searchBtn.onclick = () => { if (_hotActive) { _hotActive = false; Object.assign(hotBtn.style, _DEF_STYLE); _currentForceTags = null; } doSearch(1); };


            prevBtn.onclick = () => doSearch(currentPage - 1);
            nextBtn.onclick = () => doSearch(currentPage + 1);

            // ──── 注册 DOM Widget ────
            this.addDOMWidget("danbooru_browser_ui", "div", container, { onDraw: () => {} });

            // 等 widget 值恢复后再读取
            // 预加载收藏数据，让 ⭐ 弹窗秒开
            _getFavs();
            setTimeout(() => {
                loadRatingState();
                loadNodeSettings();
                refreshFusionBar();
                doSearch(1);
                node.onResize?.();
            }, 100);
        };
    }
});
