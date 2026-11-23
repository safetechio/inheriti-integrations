export type GuideStage = 'assets' | 'plans';

type GuideRow = {
  label: string;
  detail?: string;
  icon?: string;
  tone?: 'selected' | 'warning' | 'success';
};

export type GuidePaneContent = {
  title: string;
  icon: string;
  rows: readonly GuideRow[];
  summary?: string;
  progress?: number;
  control?: string;
  selectable?: boolean;
  group?: string;
  choices?: readonly string[];
  controlPlacement?: 'top' | 'row';
};

export type GuideFrame = {
  action: string;
  reverse?: boolean;
  left: GuidePaneContent;
  right: GuidePaneContent;
};

export type GuideGestureKind =
  'folders' | 'mapping' | 'create' | 'accept' | 'group' | 'new-plan' | 'assign' | 'undo';

export type GuideSceneContent = {
  gesture: GuideGestureKind;
  title: string;
  caption: string;
  frames: readonly [GuideFrame, GuideFrame, GuideFrame];
};

const sourceFields = {
  title: 'Source fields',
  icon: 'file-lines',
  rows: [
    { label: 'Username', detail: '••••', icon: 'user' },
    { label: 'Password', detail: '••••', icon: 'key' },
    { label: 'Region', detail: '••••', icon: 'file-lines' },
  ],
} as const;

const account = { title: 'Demo account', icon: 'user' };

const pendingFields = {
  title: 'Unassigned fields',
  selectable: true,
  icon: 'file-lines',
  rows: [
    { label: 'Access token', detail: '••••' },
    { label: 'Region', detail: '••••' },
  ],
} as const;

const proposals = { title: 'Proposed assets', icon: 'layer-group' };

const reviewList = {
  title: 'To review',
  selectable: true,
  icon: 'list-check',
  rows: [
    { label: 'Demo account', icon: 'user' },
    { label: 'Demo API key', icon: 'key' },
  ],
} as const;

const unassigned = { title: 'Unassigned assets', icon: 'layer-group', selectable: true };
const draftPlan = { title: 'Your organisation', icon: 'folder-open', group: 'Demo plan' };
const assets = [
  { label: 'Demo account', icon: 'user' },
  { label: 'Demo API key', icon: 'key' },
  { label: 'Demo notes', icon: 'file-lines' },
] as const;
const [demoAccount, demoApiKey, demoNotes] = assets;

export const guideContent: Record<
  GuideStage,
  { title: string; scenes: readonly GuideSceneContent[] }
> = {
  assets: {
    title: 'Review assets',
    scenes: [
      {
        title: 'Check where fields go',
        gesture: 'mapping',
        caption:
          'Choose **Change source**, then pick a field. Check the mapping; Region still needs a destination.',
        frames: [
          {
            action: 'Review the source',
            left: reviewList,
            right: { ...account, rows: sourceFields.rows.slice(0, 1), control: 'Change source' },
          },
          {
            action: 'Choose the Username source',
            left: reviewList,
            right: {
              ...account,
              rows: sourceFields.rows.slice(0, 1),
              control: 'Close',
              choices: ['Username', 'Region'],
            },
          },
          {
            action: '1 field still needs a destination',
            left: reviewList,
            right: {
              ...account,
              summary: '1 unassigned field · Needs review',
              rows: sourceFields.rows.slice(0, 1).map((row) => ({ ...row, tone: 'success' })),
            },
          },
        ],
      },
      {
        title: 'Create assets from pending fields',
        gesture: 'create',
        caption:
          'In **Needs review** or **Source field details**, select Unassigned fields, choose **Create assets**, review the suggestions, then **Confirm**.',
        frames: [
          {
            action: 'Select pending fields',
            left: {
              ...pendingFields,
              title: 'Demo account — Issues',
              control: 'Select all 2 fields',
              controlPlacement: 'top',
            },
            right: { ...proposals, rows: [], summary: 'No proposals yet' },
          },
          {
            action: 'Create assets',
            left: {
              ...pendingFields,
              title: 'Demo account — Issues',
              control: 'Create assets',
              rows: pendingFields.rows.map((row) => ({
                ...row,
                tone: 'selected',
              })),
            },
            right: { ...proposals, rows: [], summary: '2 fields selected' },
          },
          {
            action: 'Review the proposals',
            left: {
              title: 'To review',
              icon: 'list-check',
              rows: [
                { label: 'Demo account', icon: 'user' },
                { label: 'Demo account — Additional 1', detail: 'API Key', icon: 'key' },
                { label: 'Demo account — Additional 2', detail: 'Plain Text', icon: 'file-lines' },
              ],
            },
            right: {
              title: 'Demo account — Additional 1',
              icon: 'key',
              rows: [{ label: 'API key', detail: '••••', icon: 'key' }],
              summary: 'Review before accepting',
            },
          },
        ],
      },
      {
        title: 'Accept assets together',
        gesture: 'accept',
        caption:
          'Filter the list, choose **Select all**, then choose **Accept selected**. Excluded assets can be restored to review.',
        frames: [
          {
            action: 'Open To review',
            left: { ...reviewList, control: 'Select all', controlPlacement: 'top' },
            right: {
              ...account,
              rows: sourceFields.rows.slice(0, 2),
              summary: 'Check fields before accepting',
            },
          },
          {
            action: 'Select all',
            left: {
              ...reviewList,
              control: 'Accept selected',
              rows: reviewList.rows.map((row) => ({
                ...row,
                tone: 'selected',
              })),
            },
            right: {
              ...account,
              rows: sourceFields.rows.slice(0, 2),
              summary: '2 assets selected',
            },
          },
          {
            action: 'Accept selected',
            left: {
              ...reviewList,
              title: 'Accepted',
              rows: reviewList.rows.map((row) => ({ ...row, icon: 'check', tone: 'success' })),
            },
            right: {
              ...account,
              rows: sourceFields.rows.slice(0, 2),
              summary: 'Accepted',
            },
          },
        ],
      },
    ],
  },
  plans: {
    title: 'Create plans',
    scenes: [
      {
        title: 'Organise your organisation folders',
        gesture: 'folders',
        caption:
          'Choose **New folder**, type a name and press **Enter**. For a subfolder, open the folder’s **⋮ menu → New subfolder**, name it and press Enter.',
        frames: [
          {
            action: 'Create a folder',
            left: { ...unassigned, rows: assets },
            right: {
              title: 'Your organisation',
              icon: 'folder-open',
              rows: [],
              control: 'New folder',
              controlPlacement: 'top',
              summary: 'No folders yet',
            },
          },
          {
            action: 'Create a subfolder',
            left: { ...unassigned, rows: assets },
            right: {
              title: 'Your organisation',
              icon: 'folder-open',
              rows: [{ label: 'Demo workspace', icon: 'folder-open' }],
              control: '···',
              controlPlacement: 'row',
            },
          },
          {
            action: 'Your folder structure is ready',
            left: { ...unassigned, rows: assets },
            right: {
              title: 'Your organisation',
              icon: 'folder-open',
              rows: [
                { label: 'Demo workspace', icon: 'folder-open' },
                { label: '↳ Operations', icon: 'folder-open' },
              ],
              summary: 'Click a folder to choose where new plans go.',
            },
          },
        ],
      },
      {
        title: 'Create a plan from selected assets',
        gesture: 'new-plan',
        caption:
          'Select assets with **Ctrl/Cmd + click** or **Shift + click**. Check **Create in**, then choose **New plan** below the list. The plan appears on the right with those assets assigned. **Type its name and press Enter**.',
        frames: [
          {
            action: 'Select multiple assets',
            left: { ...unassigned, rows: assets, control: 'Select all', controlPlacement: 'top' },
            right: {
              title: 'Your organisation',
              icon: 'folder-open',
              rows: [],
              summary: 'New plans go to Your organisation',
            },
          },
          {
            action: '2 selected · Create in: Your organisation',
            left: {
              ...unassigned,
              rows: assets.map((row, index) => (index < 2 ? { ...row, tone: 'selected' } : row)),
              control: 'New plan',
              summary: '2 selected · Create in: Your organisation',
            },
            right: {
              title: 'Your organisation',
              icon: 'folder-open',
              rows: [],
              summary: 'The new plan will appear here',
            },
          },
          {
            action: 'Name your new plan on the right',
            left: { ...unassigned, rows: [demoNotes], summary: '1 asset still unassigned' },
            right: {
              ...draftPlan,
              group: 'Access plan',
              rows: [demoAccount, demoApiKey],
              summary: '2 assets assigned',
            },
          },
        ],
      },
      {
        title: 'Group unassigned assets',
        gesture: 'group',
        caption:
          '**Group unassigned assets** creates plans by source and, when enabled, source folder. Large groups are split to fit **plan capacity**. Here, all three assets share one source.',
        frames: [
          {
            action: 'Review unassigned assets',
            left: { ...unassigned, rows: assets },
            right: {
              title: 'Your organisation',
              icon: 'file-shield',
              rows: [],
              summary: '0 of 3 assigned',
              progress: 0,
              control: 'Group unassigned assets (3)',
            },
          },
          {
            action: 'Group unassigned assets',
            left: { ...unassigned, rows: assets.map((row) => ({ ...row, tone: 'selected' })) },
            right: {
              title: 'Your organisation',
              icon: 'file-shield',
              rows: [],
              summary: 'Creating a draft plan',
              control: 'Group unassigned assets (3)',
            },
          },
          {
            action: '3 assets grouped',
            left: { ...unassigned, rows: [], summary: 'All assets assigned' },
            right: {
              ...draftPlan,
              group: 'demo-import.kdbx',
              rows: assets,
              summary: '3 of 3 assigned',
              progress: 100,
            },
          },
        ],
      },
      {
        title: 'Add assets to an existing plan',
        gesture: 'assign',
        caption:
          'Select assets in **Unassigned**, then **drag them onto a draft plan** in Your organisation. You can also use **Assign to plan**.',
        frames: [
          {
            action: 'Find the destination plan',
            left: { ...unassigned, rows: [demoApiKey, demoNotes], control: 'Select all' },
            right: { ...draftPlan, rows: [demoAccount], summary: '1 asset' },
          },
          {
            action: 'Assign to plan',
            left: {
              ...unassigned,
              rows: [demoApiKey, demoNotes].map((row) => ({
                ...row,
                tone: 'selected',
              })),
            },
            right: { ...draftPlan, rows: [demoAccount], summary: 'Destination plan' },
          },
          {
            action: '2 assets moved into the plan',
            left: { ...unassigned, rows: [], summary: 'All assets assigned' },
            right: {
              ...draftPlan,
              rows: [
                demoAccount,
                { ...demoApiKey, tone: 'success' },
                { ...demoNotes, tone: 'success' },
              ],
              summary: '3 assets',
            },
          },
        ],
      },
      {
        title: 'Unassign an asset and undo',
        gesture: 'undo',
        caption:
          'Open an assigned asset’s **⋮ menu** and choose **Unassign**. Use **Undo** at the bottom of Your organisation to restore the assignment.',
        frames: [
          {
            action: 'Select an assigned asset',
            left: { ...unassigned, rows: [], summary: 'All assets assigned' },
            right: {
              ...draftPlan,
              rows: [demoAccount, { ...demoApiKey, tone: 'selected' }],
              control: '···',
              controlPlacement: 'row',
            },
          },
          {
            action: 'Unassign',
            reverse: true,
            left: { ...unassigned, rows: [{ ...demoApiKey, tone: 'warning' }] },
            right: { ...draftPlan, rows: [demoAccount], control: 'Undo' },
          },
          {
            action: 'Undo restores the assignment',
            left: { ...unassigned, rows: [], summary: 'All assets assigned' },
            right: { ...draftPlan, rows: [demoAccount, { ...demoApiKey, tone: 'success' }] },
          },
        ],
      },
    ],
  },
};
