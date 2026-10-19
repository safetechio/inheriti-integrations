################################################################################
# GOffice, built against the same guest GTK and libGSF as Gnumeric
################################################################################

WORKSPACE_GOFFICE_VERSION = 0.10.62
WORKSPACE_GOFFICE_SOURCE = goffice-$(WORKSPACE_GOFFICE_VERSION).tar.xz
WORKSPACE_GOFFICE_SITE = https://download.gnome.org/sources/goffice/0.10
WORKSPACE_GOFFICE_LICENSE = GPL-2.0+
WORKSPACE_GOFFICE_LICENSE_FILES = COPYING
WORKSPACE_GOFFICE_INSTALL_STAGING = YES
WORKSPACE_GOFFICE_DEPENDENCIES = host-pkgconf host-intltool workspace-libgsf libgtk3 \
	libglib2 libxml2 libxslt pango cairo gdk-pixbuf
WORKSPACE_GOFFICE_CONF_ENV = PKG_CONFIG_PATH=$(STAGING_DIR)/opt/workspace/apps/lib/pkgconfig
WORKSPACE_GOFFICE_CONF_OPTS = --prefix=/opt/workspace/apps \
	--exec-prefix=/opt/workspace/apps --with-gtk \
	--without-librsvg --disable-introspection

$(eval $(autotools-package))
