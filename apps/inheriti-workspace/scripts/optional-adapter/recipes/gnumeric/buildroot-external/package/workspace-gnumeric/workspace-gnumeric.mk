################################################################################
# Gnumeric, never selected by the base guest configuration
################################################################################

WORKSPACE_GNUMERIC_VERSION = 1.12.62
WORKSPACE_GNUMERIC_SOURCE = gnumeric-$(WORKSPACE_GNUMERIC_VERSION).tar.xz
WORKSPACE_GNUMERIC_SITE = https://download.gnome.org/sources/gnumeric/1.12
WORKSPACE_GNUMERIC_LICENSE = GPL-2.0+
WORKSPACE_GNUMERIC_LICENSE_FILES = COPYING
WORKSPACE_GNUMERIC_DEPENDENCIES = host-pkgconf host-intltool workspace-goffice \
	workspace-libgsf libgtk3 libglib2 pango libfribidi
WORKSPACE_GNUMERIC_CONF_ENV = PKG_CONFIG_PATH=$(STAGING_DIR)/opt/workspace/apps/lib/pkgconfig \
	ITSTOOL=/bin/true
WORKSPACE_GNUMERIC_CONF_OPTS = --prefix=/opt/workspace/apps \
	--exec-prefix=/opt/workspace/apps --with-gtk \
	--with-goffice-plugins-dir=/opt/workspace/apps/lib/goffice/0.10/plugins \
	--without-python --without-perl --without-gda \
	--disable-introspection --disable-pdfdocs
WORKSPACE_GNUMERIC_MAKE_OPTS = HELP_LINGUAS=
WORKSPACE_GNUMERIC_INSTALL_TARGET_OPTS = DESTDIR=$(TARGET_DIR) HELP_LINGUAS= install

$(eval $(autotools-package))
