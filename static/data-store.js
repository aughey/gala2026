/* Storage adapter: static hosts use bundled JSON and a browser-local draft. */
(function(root) {
  'use strict';
  function csv(document, fields) {
    const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return [fields.map(([, label]) => label), ...document.cues.map(cue =>
      fields.map(([key]) => typeof cue[key] === 'boolean' ? (cue[key] ? 'True' : 'False') : cue[key] ?? ''))]
      .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function validate(document) {
    if(document?.schema_version !== 3 || !Array.isArray(document.cues) || !document.cues.length)
      throw new Error('Choose a schema version 3 show JSON with at least one call.');
    const ids = new Set();
    for(const cue of document.cues) {
      if(!cue || typeof cue.id !== 'string' || ids.has(cue.id) || !cue.item_id ||
         !['standby','go','set','note'].includes(cue.kind) || typeof cue.confirmed !== 'boolean')
        throw new Error('Show calls must have unique IDs, program items, valid types and review flags.');
      ids.add(cue.id);
    }
  }
  function create({staticMode, storage, fetcher, scope}) {
    const key = 'gala-show-draft:' + scope;
    let published;
    async function read() {
      if(!staticMode) {
        const response = await fetcher('/api/show');
        if(!response.ok) throw new Error('Could not read show files');
        return response.json();
      }
      if(!published) {
        const response = await fetcher('data/show.json');
        if(!response.ok) throw new Error('Could not load bundled show data');
        published = await response.json();
        validate(published.working);
      }
      const draft = JSON.parse(storage.getItem(key) || 'null');
      if(draft) validate(draft.working);
      return {...published, working: draft?.working || structuredClone(published.working),
        localDraft: !!draft, newerPublished: !!draft && draft.published_version !== published.published_version};
    }
    async function save(document) {
      if(!staticMode) {
        const response = await fetcher('/api/show', {method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({revision:document.revision, cues:document.cues})});
        const data = await response.json();
        if(!response.ok) throw Object.assign(new Error(data.error || 'Save failed'), {conflict:response.status === 409});
        return data.revision;
      }
      validate(document);
      const current = await read();
      if(current.working.revision !== document.revision)
        throw Object.assign(new Error('Another tab saved changes. Download recovery JSON, then reload.'), {conflict:true});
      const working = {...document, revision:document.revision + 1};
      storage.setItem(key, JSON.stringify({published_version:published.published_version, working}));
      return working.revision;
    }
    function reset() { storage.removeItem(key); }
    return {read, save, reset};
  }
  const api = {create, csv, validate};
  if(typeof module !== 'undefined') module.exports = api;
  else root.ShowData = api;
})(typeof window === 'undefined' ? globalThis : window);
