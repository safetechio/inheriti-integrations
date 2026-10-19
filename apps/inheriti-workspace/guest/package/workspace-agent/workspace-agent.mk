################################################################################
# Inheriti Workspace guest agent; source stays in this br2-external tree.
################################################################################

WORKSPACE_AGENT_VERSION = 1
WORKSPACE_AGENT_SITE = $(BR2_EXTERNAL_INHERITI_WORKSPACE_PATH)/package/workspace-agent
WORKSPACE_AGENT_SITE_METHOD = local
WORKSPACE_AGENT_LICENSE = LicenseRef-Inheriti-Proprietary
WORKSPACE_AGENT_DEPENDENCIES = libzip libxml2 mupdf

define WORKSPACE_AGENT_BUILD_CMDS
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -O2 -Wall -Wextra -Werror \
		-o $(@D)/workspace-agent $(@D)/workspace-agent.c $(@D)/format_catalog.c \
		$(@D)/applications/catalog.c $(@D)/applications/image/launch.c \
		$(@D)/applications/pdf/launch.c $(@D)/applications/text/launch.c \
		$(@D)/applications/optional/launch.c
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -O2 -Wall -Wextra -Werror \
		-I$(STAGING_DIR)/usr/include/libxml2 \
		-o $(@D)/workspace-xlsx-to-tsv $(@D)/xlsx/xlsx_to_tsv.c -L$(STAGING_DIR)/usr/lib -lzip -lxml2
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -O2 -Wall -Wextra -Werror \
		-I$(STAGING_DIR)/usr/include/libxml2 \
		-o $(@D)/workspace-document-to-text $(@D)/documents/main.c \
		$(@D)/documents/document_converter.c -L$(STAGING_DIR)/usr/lib -lzip -lxml2
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -O2 -Wall -Wextra -Werror \
		-o $(@D)/workspace-zip-index $(@D)/archive/zip_index.c -L$(STAGING_DIR)/usr/lib -lzip
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -O2 -Wall -Wextra -Werror \
		-o $(@D)/workspace-ooxml-validate $(@D)/documents/ooxml_validate.c -L$(STAGING_DIR)/usr/lib -lzip
endef

define WORKSPACE_AGENT_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/workspace-agent $(TARGET_DIR)/usr/sbin/workspace-agent
	$(INSTALL) -D -m 0755 $(@D)/workspace-xlsx-to-tsv $(TARGET_DIR)/usr/bin/workspace-xlsx-to-tsv
	$(INSTALL) -D -m 0755 $(@D)/workspace-document-to-text $(TARGET_DIR)/usr/bin/workspace-document-to-text
	$(INSTALL) -D -m 0755 $(@D)/workspace-zip-index $(TARGET_DIR)/usr/bin/workspace-zip-index
	$(INSTALL) -D -m 0755 $(@D)/workspace-ooxml-validate $(TARGET_DIR)/usr/bin/workspace-ooxml-validate
endef

$(eval $(generic-package))
