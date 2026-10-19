#ifndef WORKSPACE_FORMAT_CATALOG_H
#define WORKSPACE_FORMAT_CATALOG_H

#include <stddef.h>

/* File recognition and size policy live in format_catalog.c. Application
 * selection lives in applications/catalog.c; converters create limited views. */
struct workspace_application;
enum workspace_format {
    FORMAT_UNSUPPORTED, FORMAT_PNG, FORMAT_JPEG, FORMAT_TEXT, FORMAT_JSON,
    FORMAT_CSV, FORMAT_PDF, FORMAT_XLSX, FORMAT_DOCX, FORMAT_ODT, FORMAT_ZIP,
    FORMAT_MP4, FORMAT_WEBM
};
struct workspace_viewer {
    enum workspace_format format;
    const char *family;
    const char *suffix;
    const struct workspace_application *application;
    const char *converter;
    size_t max_bytes;
};

const struct workspace_viewer *workspace_detect_format(const char *name, const unsigned char *data, size_t size);

#endif
