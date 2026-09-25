const fs = require('fs');
const p = 'moris/src/components/admin/AdminProductsTab.tsx';
let s = fs.readFileSync(p, 'utf8');

// Remove the first duplicate AI input field (inside the basic info section of ProductForm).
const firstAiInput = `
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Image URL for AI</label>
              <input
                type="url"
                value={aiImagePreview || ''}
                onChange={e => setAiImagePreview(e.target.value)}
                placeholder="https://example.com/product-image.jpg"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-slate-200 focus:outline-none focus:border-yellow-500"
              />
            </div>
          </div>
        </div>

        {/* Images */}`;

const replacement1 = `
            </div>
          </div>

        {/* Images */}`;

console.log('count1:', s.split(firstAiInput).length - 1);
s = s.split(firstAiInput).join(replacement1);

// Remove the second duplicate AI input field (inside the images section of ProductForm).
const secondAiInput = `
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Image URL for AI</label>
              <input
                type="url"
                value={aiImagePreview || ''}
                onChange={e => setAiImagePreview(e.target.value)}
                placeholder="https://example.com/product-image.jpg"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-slate-200 focus:outline-none focus:border-yellow-500"
              />
            </div>
          </div>

          <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-700 mb-4">`;

const replacement2 = `
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Image URL (optional)</label>
              <input
                type="url"
                value={''}
                onChange={e => {}}
                placeholder="https://example.com/product-image.jpg"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-slate-200 focus:outline-none focus:border-yellow-500"
                disabled
              />
            </div>
          </div>

          <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-700 mb-4">`;

console.log('count2:', s.split(secondAiInput).length - 1);
s = s.split(secondAiInput).join(replacement2);

fs.writeFileSync(p, s);
console.log('written');
