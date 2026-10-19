#ifndef WORKSPACE_APPLICATION_CATALOG_H
#define WORKSPACE_APPLICATION_CATALOG_H

#include "../format_catalog.h"

struct workspace_application {
    const char *name;
    const char *binary;
    int signals_ready;
    void (*launch)(const char *binary, const char *file, const char *view,
                   const char *session_dir);
};

extern const struct workspace_application workspace_image_application;
extern const struct workspace_application workspace_pdf_application;
extern const struct workspace_application workspace_text_application;

/* Select one approved, mounted guest application or retain the built-in viewer. */
const struct workspace_application *workspace_select_application(
    enum workspace_format format, const struct workspace_application *builtin);

#endif
