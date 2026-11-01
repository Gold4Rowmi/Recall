import { computeSnapshot } from './analytics.js';

self.onmessage = e => {
  try { self.postMessage({ id:e.data.id, snapshot:computeSnapshot(e.data.input) }); }
  catch (err){ self.postMessage({ id:e.data.id, error:err.message || String(err) }); }
};
