import type { RichAnswer } from '../rich-answers.js';

export const RICH_ANSWER_FIXTURE: RichAnswer = {
  version: 1,
  components: [
    { id: 'metric', type: 'metric', label: 'Conversion', value: 42, tone: 'success' },
    { id: 'table', type: 'table', columns: ['Name', 'Value'], rows: [['A', '1']] },
    { id: 'chart', type: 'chart', chart: 'bar', labels: ['Jan', 'Feb'], values: [1, 2] },
    { id: 'checklist', type: 'checklist', items: [{ id: 'a', label: 'Done', checked: false }] },
    { id: 'choices', type: 'choices', mode: 'single', options: [{ id: 'a', label: 'A' }] },
    { id: 'slider', type: 'slider', label: 'Level', min: 0, max: 10, step: 1, value: 5 },
    { id: 'callout', type: 'callout', tone: 'info', text: 'Note' },
    { id: 'steps', type: 'steps', items: [{ id: 'one', title: 'One', text: 'First' }] },
    { id: 'kv', type: 'kv', items: [{ key: 'A', value: 'B' }] },
  ],
};
