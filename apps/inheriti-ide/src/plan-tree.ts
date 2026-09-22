import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { planAvatarSvg } from '@safetech/inheriti-elements-brand';
import type { PlanViewState } from './plan-view-model.js';
import { rowsFor } from './plan-view-model.js';

/** A thin adapter: every decision about what a state looks like lives in `plan-view-model`. */
export class PlanTreeProvider implements vscode.TreeDataProvider<PlanTreeItem> {
  private readonly changed = new vscode.EventEmitter<PlanTreeItem | undefined>();
  private state: PlanViewState = { kind: 'SIGNED_OUT' };

  public constructor(private readonly avatarRoot?: vscode.Uri) {}

  public readonly onDidChangeTreeData = this.changed.event;

  public render(state: PlanViewState): void {
    this.state = state;
    this.changed.fire(undefined);
  }

  public getTreeItem(item: PlanTreeItem): vscode.TreeItem {
    return item;
  }

  public getChildren(): PlanTreeItem[] | Promise<PlanTreeItem[]> {
    const items = rowsFor(this.state).map((row) => new PlanTreeItem(row.label, row.description, row.contextValue, row.planId));
    if (!this.avatarRoot) return items;
    return this.withAvatars(items, this.avatarRoot);
  }

  private async withAvatars(items: PlanTreeItem[], root: vscode.Uri): Promise<PlanTreeItem[]> {
    try { await vscode.workspace.fs.createDirectory(root); } catch { return items; }
    await Promise.allSettled(items.map(async (item) => {
      if (!item.planId) return;
      const name = createHash('sha256').update(item.planId).digest('hex');
      const uri = vscode.Uri.joinPath(root, `${name}.svg`);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(planAvatarSvg(item.planId)));
      item.iconPath = uri;
    }));
    return items;
  }
}

export class PlanTreeItem extends vscode.TreeItem {
  public constructor(
    label: string,
    description: string,
    contextValue: 'plan' | 'message',
    public readonly planId?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = contextValue;
    if (planId !== undefined) {
      this.command = { command: 'inheriti.openPlan', title: 'Open plan', arguments: [planId] };
    }
  }
}
