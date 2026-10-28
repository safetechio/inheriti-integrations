import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Box, Icon, Pressable, Text } from '@modules/_shared/ui/components';
import useOrganizationMemberships from '@modules/organization/application/use-organization-memberships';
import useSelectCurrentOrganization from '@modules/organization/application/use-select-current-organization';
import { organizationDisplayName } from '@modules/organization/application/organization-display-name';

export function OrganizationMenu({
  menuRef,
  open,
  setOpen,
  closeMenu,
  closeAccountMenu,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  closeMenu: (returnFocus?: boolean) => void;
  closeAccountMenu: (returnFocus?: boolean) => void;
}) {
  const { organization, loading: switching, selectOrganization } = useSelectCurrentOrganization();
  const { memberships } = useOrganizationMemberships();
  const selectedOrganizationName = organization
    ? organizationDisplayName(organization, memberships)
    : 'Choose organisation';

  return (
    <Box ref={menuRef} position="relative">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change organisation. Current organisation: ${selectedOrganizationName}`}
        {...{ 'aria-expanded': open }}
        disabled={switching}
        onPress={() => {
          setOpen((value) => !value);
          closeAccountMenu(false);
        }}
      >
        <Box
          className="organization-switcher"
          flexDirection="row"
          alignItems="center"
          gap="s"
          borderWidth={1}
          borderColor="primary30"
          borderRadius="pill"
          paddingHorizontal="m"
          height={40}
          style={{ cursor: switching ? 'wait' : 'pointer', opacity: switching ? 0.7 : 1 }}
        >
          <Icon name="building" size={18} color="primary" label="Organisation" />
          <Text variant="bodySmall" color="primary120" numberOfLines={1}>
            {selectedOrganizationName}
          </Text>
          <Icon name="chevron-down" size={16} color="primary" label="Change organisation" />
        </Box>
      </Pressable>
      {open ? (
        <Box
          className="organization-menu"
          accessibilityRole="menu"
          accessibilityLabel="Organisations"
          position="absolute"
          top="100%"
          right={0}
          width={260}
          padding="s"
          gap="xxs"
          backgroundColor="white"
          borderRadius="m"
          borderWidth={1}
          borderColor="gray10"
          style={{ zIndex: 1000, elevation: 20, boxShadow: '0 12px 28px rgba(16, 24, 40, 0.12)' }}
        >
          <Text variant="bodySmall" color="gray" style={{ padding: 8 }}>
            Organisation
          </Text>
          {memberships.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="menuitem"
              accessibilityLabel={`Switch to ${organizationDisplayName(item, memberships)}`}
              {...{ 'aria-selected': item.id === organization?.id }}
              onPress={() => {
                closeMenu();
                void selectOrganization(item.id);
              }}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                gap="s"
                padding="s"
                borderRadius="s"
                backgroundColor={item.id === organization?.id ? 'primary5' : 'white'}
                style={{ cursor: 'pointer' }}
              >
                <Icon
                  name="building"
                  size={16}
                  color={item.id === organization?.id ? 'primary' : 'gray'}
                />
                <Text variant="bodySmall" color="gray120" numberOfLines={1}>
                  {organizationDisplayName(item, memberships)}
                </Text>
              </Box>
            </Pressable>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
