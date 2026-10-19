#include "format_catalog.h"
#include "applications/catalog.h"
#include <ctype.h>
#include <string.h>
#include <strings.h>

#define MAX_IMAGE (16u * 1024u * 1024u)
#define MAX_TEXT (1024u * 1024u)
#ifndef WORKSPACE_XLSX_CONVERTER
#define WORKSPACE_XLSX_CONVERTER "/usr/bin/workspace-xlsx-to-tsv"
#endif
#ifndef WORKSPACE_DOCUMENT_CONVERTER
#define WORKSPACE_DOCUMENT_CONVERTER "/usr/bin/workspace-document-to-text"
#endif
#ifndef WORKSPACE_ZIP_CONVERTER
#define WORKSPACE_ZIP_CONVERTER "/usr/bin/workspace-zip-index"
#endif

static const struct workspace_viewer catalog[] = {
    {FORMAT_PNG, "PNG image", ".png", &workspace_image_application, NULL, MAX_IMAGE},
    {FORMAT_JPEG, "JPEG image", ".jpg", &workspace_image_application, NULL, MAX_IMAGE},
    {FORMAT_TEXT, "UTF-8 text", ".txt", &workspace_text_application, NULL, MAX_TEXT},
    {FORMAT_JSON, "JSON text", ".json", &workspace_text_application, NULL, MAX_TEXT},
    {FORMAT_CSV, "CSV text", ".csv", &workspace_text_application, NULL, MAX_TEXT},
    {FORMAT_PDF, "PDF document", ".pdf", &workspace_pdf_application, NULL, 8u * 1024u * 1024u},
    {FORMAT_XLSX, "XLSX spreadsheet", ".xlsx", &workspace_text_application, WORKSPACE_XLSX_CONVERTER, MAX_IMAGE},
    {FORMAT_DOCX, "DOCX document", ".docx", &workspace_text_application, WORKSPACE_DOCUMENT_CONVERTER, MAX_IMAGE},
    {FORMAT_ODT, "ODT document", ".odt", &workspace_text_application, WORKSPACE_DOCUMENT_CONVERTER, MAX_IMAGE},
    {FORMAT_ZIP, "ZIP archive index", ".zip", &workspace_text_application, WORKSPACE_ZIP_CONVERTER, MAX_IMAGE},
    {FORMAT_MP4, "MP4 video", ".mp4", NULL, NULL, MAX_IMAGE},
    {FORMAT_WEBM, "WebM video", ".webm", NULL, NULL, MAX_IMAGE},
};

static int suffix_is(const char *name, const char *suffix) {
    size_t n = strlen(name), s = strlen(suffix);
    return n >= s && strcasecmp(name + n - s, suffix) == 0;
}

/* Reject terminal controls, malformed UTF-8, bidi overrides and huge lines. */
static int safe_utf8(const unsigned char *p, size_t size) {
    size_t line = 0;
    for (size_t i = 0; i < size;) {
        unsigned char a = p[i++];
        if (a == '\n') { line = 0; continue; }
        if (++line > 16384) return 0;
        if (a == '\r') { if (i == size || p[i] != '\n') return 0; continue; }
        if (a == '\t' || (a >= 32 && a <= 126)) continue;
        if (a < 0xc2 || a > 0xf4) return 0;
        unsigned len = a < 0xe0 ? 2 : a < 0xf0 ? 3 : 4;
        if (size - i < len - 1) return 0;
        unsigned code = a & (len == 2 ? 31u : len == 3 ? 15u : 7u);
        for (unsigned j = 1; j < len; j++) {
            unsigned char b = p[i++];
            if ((b & 0xc0) != 0x80) return 0;
            code = (code << 6) | (b & 63u);
        }
        if (code < (len == 2 ? 0x80u : len == 3 ? 0x800u : 0x10000u) ||
            code > 0x10ffffu || (code >= 0xd800u && code <= 0xdfffu) ||
            (code >= 0x80u && code <= 0x9fu) ||
            (code >= 0x202au && code <= 0x202eu) ||
            (code >= 0x2066u && code <= 0x2069u)) return 0;
    }
    return 1;
}

const struct workspace_viewer *workspace_detect_format(const char *name, const unsigned char *data, size_t size) {
    if (size >= 8 && memcmp(data, "\x89PNG\r\n\x1a\n", 8) == 0) return &catalog[0];
    if (size >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff) return &catalog[1];
    if (size >= 5 && memcmp(data, "%PDF-", 5) == 0) return &catalog[5];
    if (suffix_is(name, ".mp4") && size >= 12 &&
        memcmp(data + 4, "ftyp", 4) == 0) return &catalog[10];
    if (suffix_is(name, ".webm") && size >= 4 &&
        memcmp(data, "\x1a\x45\xdf\xa3", 4) == 0) return &catalog[11];
    /* ZIP signatures only nominate a converter; it must validate the archive before ACK. */
    if (size >= 4 && memcmp(data, "PK\003\004", 4) == 0) {
        if (suffix_is(name, ".xlsx")) return &catalog[6];
        if (suffix_is(name, ".docx")) return &catalog[7];
        if (suffix_is(name, ".odt")) return &catalog[8];
        if (suffix_is(name, ".zip")) return &catalog[9];
        return NULL;
    }
    /* An empty ZIP starts with the end-of-central-directory record. */
    if (size >= 4 && memcmp(data, "PK\005\006", 4) == 0 && suffix_is(name, ".zip"))
        return &catalog[9];
    /* Do not treat executables, scripts or unsupported archives as text. */
    if ((size >= 2 && ((data[0] == 'M' && data[1] == 'Z') ||
                       (data[0] == '#' && data[1] == '!') ||
                       (data[0] == 'P' && data[1] == 'K'))) ||
        (size >= 4 && (memcmp(data, "\x7f" "ELF", 4) == 0 ||
                       memcmp(data, "\xcf\xfa\xed\xfe", 4) == 0 ||
                       memcmp(data, "\xfe\xed\xfa\xcf", 4) == 0))) return NULL;
    if (!size || size > MAX_TEXT || !safe_utf8(data, size)) return NULL;
    size_t first = 0, last = size;
    while (first < size && isspace(data[first])) first++;
    while (last > first && isspace(data[last - 1])) last--;
    if (first == last) return &catalog[2];
    if ((data[first] == '{' && data[last - 1] == '}') ||
        (data[first] == '[' && data[last - 1] == ']')) return &catalog[3];
    if (suffix_is(name, ".csv") && memchr(data, ',', size)) return &catalog[4];
    return &catalog[2];
}
