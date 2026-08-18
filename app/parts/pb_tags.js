'use strict';
/* tovo - maerkaterne.
 *
 * Et tag uden et tal er en gaettekonkurrence: "#internt" siger ingenting, foer
 * man kan se, at der sidder fjorten opgaver paa det. Derfor er antallet det
 * foerste, listen viser - og et klik aabner opgaverne bag tallet.
 */

async function tegnTags() {
  const host = document.getElementById('pageHost');
  const [t, d] = await Promise.all([
    api('GET', '/api/v1/tags'),
    api('GET', '/api/v1/items?kind=task'),
  ]);
  state.items = d.items;
  const valgt = state.openTag && t.tags.find((x) => x.id === state.openTag);
  const opgaver = valgt
    ? d.items.filter((o) => (o.tagIds || []).includes(valgt.id))
    : [];
  const aabne = opgaver.filter((o) => o.status !== 'done');
  const faerdige = opgaver.filter((o) => o.status === 'done');

  host.innerHTML = `<div class="page">
    <h1>Tags</h1>
    <p class="lead">${esc(BESKRIVELSER.tags)}</p>

    ${t.tags.length ? `<div class="tagliste">
      ${t.tags.map((x) => `<button class="tagkort${valgt && valgt.id === x.id ? ' on' : ''}"
          data-tag="${esc(x.id)}">
          <span class="tagnavn">#${esc(x.name)}</span>
          <span class="tagtal">${x.count}</span>
          <span class="meta">${x.open} open</span>
        </button>`).join('')}
    </div>` : `<div class="empty"><p class="empty-title">No tags yet</p>
      <p>Write <code>#name</code> when you capture a task — or type <code>#</code> in the field
      above to create one on its own.</p></div>`}

    ${valgt ? `
      <div class="row" style="justify-content:space-between;align-items:baseline;margin-top:22px">
        <h2 class="group">#${esc(valgt.name)}<span class="group-count">${opgaver.length}</span></h2>
        <span class="row" style="gap:8px">
          <button class="linkbtn" id="tagOmdoeb">rename</button>
          <button class="linkbtn" id="tagSlet">delete tag</button>
        </span>
      </div>
      <div data-keynav>
        ${afsnit('Open', aabne)}
        ${faerdige.length ? afsnit('Done', faerdige, { foldbar: true, noegle: `tag-faerdige-${valgt.id}` }) : ''}
      </div>
      ${!opgaver.length ? '<div class="empty"><p>Nothing carries this tag right now.</p></div>' : ''}
      <p class="hintline meta">Arrow keys move into the list · Enter opens · ⌘↵ starts the timer</p>
    ` : (t.tags.length ? '<p class="meta" style="margin-top:18px">Pick a tag to see what carries it.</p>' : '')}
  </div>`;

  host.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      // Et klik paa det valgte slaar det fra igen - ellers er der ingen vej
      // tilbage til hele listen uden at forlade siden.
      state.openTag = state.openTag === el.dataset.tag ? null : el.dataset.tag;
      tegnSide();
    });
  });
  if (valgt) {
    bindOpgaveListe(host);
    document.getElementById('tagOmdoeb').addEventListener('click', () => omdoebTag(valgt));
    document.getElementById('tagSlet').addEventListener('click', () => sletTag(valgt, opgaver.length));
  }
}

function omdoebTag(tag) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Rename tag">
      <h2>Rename #${esc(tag.name)}</h2>
      <p class="meta">The tag keeps its place on every task — only the name changes.</p>
      <label class="field"><span>Name</span>
        <input class="input" id="tgNavn" value="${esc(tag.name)}"></label>
      <div class="modal-foot">
        <button class="btn primary" id="tgGem">Save</button>
        <button class="btn" id="tgLuk">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('tgLuk').addEventListener('click', luk);
  document.getElementById('tgGem').addEventListener('click', async () => {
    const navn = document.getElementById('tgNavn').value.trim();
    if (!navn) { toast('A tag needs a name.'); return; }
    try {
      await api('PATCH', `/api/v1/items/${tag.id}`, { name: navn });
      luk();
      await genindlaes();
      toast('Renamed.');
    } catch (ex) { toast(ex.message); }
  });
  document.getElementById('tgNavn').focus();
}

/**
 * Sletning fjerner ogsaa maerkatet FRA opgaverne - serveren gør det i samme
 * kald. Og den sender navnet og de ramte opgaver tilbage, saa fortrydelsen
 * kan saette begge dele paa plads igen i stedet for at gaette.
 */
async function sletTag(tag, antal) {
  try {
    const d = await api('DELETE', `/api/v1/tags/${tag.id}`);
    state.openTag = null;
    await genindlaes();
    toast(`#${d.deleted.name} deleted${antal ? ` and taken off ${antal} task${antal > 1 ? 's' : ''}` : ''}.`, {
      label: 'Undo',
      run: async () => {
        try {
          const ny = await api('POST', '/api/v1/items', { kind: 'tag', name: d.deleted.name });
          for (const id of d.taskIds) {
            const opgave = (await api('GET', `/api/v1/items/${id}`)).item;
            await api('PATCH', `/api/v1/items/${id}`, {
              tagIds: (opgave.tagIds || []).concat([ny.item.id]),
            });
          }
          await genindlaes();
          toast(`#${ny.item.name} is back on ${d.taskIds.length} task${d.taskIds.length === 1 ? '' : 's'}.`);
        } catch (ex) { toast(ex.message); }
      },
    });
  } catch (ex) { toast(ex.message); }
}
