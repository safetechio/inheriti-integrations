################################################################################
# libGSF, built for the Workspace guest and installed under the adapter prefix
################################################################################

WORKSPACE_LIBGSF_VERSION = 1.14.60
WORKSPACE_LIBGSF_SOURCE = libgsf-$(WORKSPACE_LIBGSF_VERSION).tar.xz
WORKSPACE_LIBGSF_SITE = https://download.gnome.org/sources/libgsf/1.14
WORKSPACE_LIBGSF_LICENSE = LGPL-2.1+
WORKSPACE_LIBGSF_LICENSE_FILES = COPYING
WORKSPACE_LIBGSF_INSTALL_STAGING = YES
WORKSPACE_LIBGSF_DEPENDENCIES = host-pkgconf host-intltool libglib2 libxml2
WORKSPACE_LIBGSF_CONF_OPTS = --prefix=/opt/workspace/apps \
	--exec-prefix=/opt/workspace/apps --disable-introspection

$(eval $(autotools-package))
