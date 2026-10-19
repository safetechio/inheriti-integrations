#define _POSIX_C_SOURCE 200809L
#include "catalog.h"
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define WORKSPACE_ADAPTER_ROOT "/opt/workspace/apps"

void workspace_launch_image(const char *, const char *, const char *, const char *);
void workspace_launch_pdf(const char *, const char *, const char *, const char *);
void workspace_launch_text(const char *, const char *, const char *, const char *);
void workspace_launch_optional(const char *, const char *, const char *, const char *);

/* Change an application's binary or launcher here without changing file admission. */
const struct workspace_application workspace_image_application = {
    "Images", "/usr/bin/feh", 0, workspace_launch_image
};
const struct workspace_application workspace_pdf_application = {
    "PDF documents", "/usr/bin/mupdf-x11", 0, workspace_launch_pdf
};
const struct workspace_application workspace_text_application = {
    "Text and limited document views", "/usr/bin/xterm", 0, workspace_launch_text
};

static const struct workspace_application optional_application = {
    "Optional guest application", WORKSPACE_ADAPTER_ROOT "/bin/launch", 0,
    workspace_launch_optional
};

/* The guest format, not a caller-controlled filename, determines the family. */
static const char *family_for_format(enum workspace_format format) {
    switch (format) {
        case FORMAT_PNG: case FORMAT_JPEG: return "image";
        case FORMAT_PDF: return "pdf";
        case FORMAT_TEXT: case FORMAT_JSON: return "text";
        case FORMAT_CSV: case FORMAT_XLSX: return "spreadsheet";
        case FORMAT_DOCX: return "document";
        case FORMAT_MP4: case FORMAT_WEBM: return "video";
        /* ODT and ZIP still require their built-in converter before admission. */
        case FORMAT_ODT: case FORMAT_ZIP: return NULL;
        default: return NULL;
    }
}

const struct workspace_application *workspace_select_application(
    enum workspace_format format, const struct workspace_application *builtin) {
    const char *expected = family_for_format(format);
    if (!expected) return builtin;
    const char *root = WORKSPACE_ADAPTER_ROOT;
#ifdef WORKSPACE_AGENT_TEST
    const char *test_root = getenv("WORKSPACE_TEST_ADAPTER_ROOT");
    if (test_root) root = test_root;
#endif
    struct stat st;
    if (lstat(root, &st) || !S_ISDIR(st.st_mode)) return builtin;
    char family_path[4096], bin_path[4096], launch_path[4096];
    if (snprintf(family_path, sizeof family_path, "%s/family", root) >= (int)sizeof family_path ||
        snprintf(bin_path, sizeof bin_path, "%s/bin", root) >= (int)sizeof bin_path ||
        snprintf(launch_path, sizeof launch_path, "%s/bin/launch", root) >= (int)sizeof launch_path)
        return builtin;
    if (lstat(bin_path, &st) || !S_ISDIR(st.st_mode)) return builtin;
    int fd = open(family_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return builtin;
    char family[32];
    ssize_t length = read(fd, family, sizeof family);
    int valid = fstat(fd, &st) == 0 && S_ISREG(st.st_mode) &&
                st.st_size > 0 && st.st_size <= (off_t)sizeof family && length == st.st_size;
    close(fd);
    if (!valid) return builtin;
    if (family[length - 1] == '\n') length--;
    if (length != (ssize_t)strlen(expected) || memcmp(family, expected, (size_t)length)) return builtin;
    if (lstat(launch_path, &st) || !S_ISREG(st.st_mode) || !(st.st_mode & 0111)) return builtin;
#ifdef WORKSPACE_AGENT_TEST
    static struct workspace_application test_application;
    static char test_launch_path[4096];
    memcpy(test_launch_path, launch_path, strlen(launch_path) + 1);
    test_application = optional_application;
    test_application.binary = test_launch_path;
    return &test_application;
#else
    return &optional_application;
#endif
}
