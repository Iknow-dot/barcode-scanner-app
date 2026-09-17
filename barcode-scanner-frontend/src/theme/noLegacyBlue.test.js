import fs from 'fs';
import path from 'path';

// antd's default blue family, plus the old avatar blue. The app's accent is
// the iknow green in src/theme/tokens.css; none of these should come back.
const LEGACY_BLUE = /#(1677ff|4096ff|0958d9|69b1ff|91caff|bae0ff|e6f4ff|e6f7ff|0765c2)\b|rgba?\(\s*(22,\s*119,\s*255|24,\s*144,\s*255|64,\s*150,\s*255|7,\s*101,\s*194)\s*,/i;
const BLUE_TAG = /<Tag\b[^>]*\bcolor=["']blue["']/;

const SRC = path.join(__dirname, '..');

const walk = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
});

const offenders = (extension, pattern) => walk(SRC)
    .filter((file) => file.endsWith(extension) && !file.endsWith('.test.js'))
    .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
        .map((line, index) => (pattern.test(line) ? `${path.relative(SRC, file)}:${index + 1}` : null))
        .filter(Boolean));

test('no JS file hard-codes antd blue', () => {
    expect(offenders('.js', LEGACY_BLUE)).toEqual([]);
});

test('no Tag uses the blue preset (use className="if-tag-tint")', () => {
    expect(offenders('.js', BLUE_TAG)).toEqual([]);
});
