import { useState } from 'react';
import { Box, Card } from '@main-components';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type { Folder, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface/types';

export function LargeOrganisationTree() {
  const [{ folders, plans }] = useState(() => {
    const folders: Folder[] = [];
    const plans: PlanDraft[] = [];
    for (let index = 0; index < 100; index++) {
      const id = `department-${index}`;
      folders.push({
        id,
        name: `Bulk destination ${index}`,
        parentId: null,
        scope: 'SHARED',
        revision: 1,
      });
      for (let child = 0; child < 2; child++) {
        const folderId = `${id}-${child}`;
        folders.push({
          id: folderId,
          name: `Service ${index}-${child}`,
          parentId: id,
          scope: 'SHARED',
          revision: 1,
        });
        plans.push({
          id: `plan-${index}-${child}`,
          name: `Service plan ${index}-${child}`,
          folderId,
          assets: 0,
          capacity: '10',
          valid: true,
        });
      }
    }
    return { folders, plans };
  });
  return (
    <Box padding="m">
      <Card style={{ height: 700, maxWidth: 1000 }}>
        <OrganizationFolderTree
          workspace={{ folders, scope: 'SHARED' }}
          plans={plans}
          dragAssets={[]}
        />
      </Card>
    </Box>
  );
}
