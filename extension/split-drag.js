let draggedId = null;
const type = 'application/x-ama-tab';

function clearTargets() {
  document.querySelectorAll('.split-drop-target').forEach(node => node.classList.remove('split-drop-target'));
}

export function attachSplitDrag(node, tab, onSplit) {
  node.draggable = true;
  node.title = '拖到另一个标签上以分屏；两个标签须在同一标签组';
  node.addEventListener('dragstart', event => {
    if (!event.dataTransfer) return;
    draggedId = tab.id;
    event.dataTransfer.setData(type, String(tab.id));
    event.dataTransfer.effectAllowed = 'move';
  });
  node.addEventListener('dragover', event => {
    if (draggedId === null || draggedId === tab.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.classList.add('split-drop-target');
  });
  node.addEventListener('dragleave', event => {
    if (!node.contains(event.relatedTarget)) node.classList.remove('split-drop-target');
  });
  node.addEventListener('drop', event => {
    event.preventDefault();
    const sourceId = draggedId;
    const payload = event.dataTransfer?.getData(type);
    draggedId = null;
    clearTargets();
    if (sourceId !== null && sourceId !== tab.id && payload === String(sourceId)) onSplit(sourceId, tab.id);
  });
  node.addEventListener('dragend', () => { draggedId = null; clearTargets(); });
}
