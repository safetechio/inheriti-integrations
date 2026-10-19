#define _POSIX_C_SOURCE 200809L
#include "document_converter.h"

#include <libxml/xmlreader.h>
#include <zip.h>
#include <ctype.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <unistd.h>

#define MAX_ARCHIVE (16u * 1024u * 1024u)
#define MAX_ENTRIES 512
#define MAX_XML (4u * 1024u * 1024u)
#define MAX_OUTPUT (2u * 1024u * 1024u)
#define MAX_DEPTH 64

static int ends_with(const char *name, const char *end) {
    size_t n = strlen(name), e = strlen(end);
    return n >= e && strcasecmp(name + n - e, end) == 0;
}

static int contains_bytes(const unsigned char *data, size_t length, const char *needle) {
    size_t n = strlen(needle);
    if (n > length) return 0;
    for (size_t i = 0; i <= length - n; i++)
        if (memcmp(data + i, needle, n) == 0) return 1;
    return 0;
}

static int dangerous_name(const char *name) {
    if (!*name || name[0] == '/' || strchr(name, '\\')) return 1;
    for (const char *p = name; *p; p++) {
        if ((unsigned char)*p < 32 || (p[0] == '.' && p[1] == '.' &&
            (p == name || p[-1] == '/') && (p[2] == '/' || p[2] == '\0'))) return 1;
    }
    return 0;
}

/* XML is parsed from one bounded member, never from an archive path or URL. */
static unsigned char *read_member(zip_t *archive, zip_uint64_t index, size_t length) {
    unsigned char *bytes = malloc(length + 1);
    if (!bytes) return NULL;
    zip_file_t *file = zip_fopen_index(archive, index, 0);
    if (!file) { free(bytes); return NULL; }
    size_t done = 0;
    while (done < length) {
        zip_int64_t got = zip_fread(file, bytes + done, length - done);
        if (got <= 0) break;
        done += (size_t)got;
    }
    unsigned char extra;
    zip_int64_t more = zip_fread(file, &extra, 1);
    int close_result = zip_fclose(file);
    if (done != length || more != 0 || close_result != 0) { free(bytes); return NULL; }
    bytes[length] = 0;
    return bytes;
}

static int append(FILE *out, size_t *used, const unsigned char *text, size_t length) {
    if (length > MAX_OUTPUT - *used) return -1;
    if (fwrite(text, 1, length, out) != length) return -1;
    *used += length;
    return 0;
}

/* Keep printable Unicode, tabs and newlines; remove terminal escapes and bidi controls. */
static int write_safe_text(FILE *out, size_t *used, const xmlChar *text) {
    const unsigned char *p = text;
    while (*p) {
        unsigned char a = *p;
        size_t width = a < 0x80 ? 1 : a < 0xe0 ? 2 : a < 0xf0 ? 3 : 4;
        uint32_t cp = a & (width == 1 ? 0x7fu : width == 2 ? 0x1fu : width == 3 ? 0x0fu : 0x07u);
        for (size_t i = 1; i < width; i++) cp = (cp << 6) | (p[i] & 0x3fu);
        if (cp == '\t') { if (append(out, used, (const unsigned char *)" ", 1)) return -1; }
        else if (cp >= 32 && cp != 127 && !(cp >= 0x80 && cp <= 0x9f) &&
                 !(cp >= 0x202a && cp <= 0x202e) && !(cp >= 0x2066 && cp <= 0x2069)) {
            if (append(out, used, p, width)) return -1;
        }
        p += width;
    }
    return 0;
}

static int xml_to_text(const unsigned char *xml, size_t length, FILE *out, int odt) {
    xmlTextReaderPtr reader = xmlReaderForMemory((const char *)xml, (int)length,
                                                  NULL, NULL, XML_PARSE_NONET | XML_PARSE_NODICT);
    if (!reader) return -1;
    size_t used = 0;
    int active = 0, result = -1, status;
    while ((status = xmlTextReaderRead(reader)) == 1) {
        int type = xmlTextReaderNodeType(reader), depth = xmlTextReaderDepth(reader);
        if (depth < 0 || depth > MAX_DEPTH || type == XML_READER_TYPE_DOCUMENT_TYPE ||
            type == XML_READER_TYPE_ENTITY || type == XML_READER_TYPE_ENTITY_REFERENCE) goto end;
        const xmlChar *local = xmlTextReaderConstLocalName(reader);
        const xmlChar *ns = xmlTextReaderConstNamespaceUri(reader);
        if (type == XML_READER_TYPE_ELEMENT && depth == 0) {
            if (odt ? !xmlStrEqual(local, BAD_CAST "document-content") ||
                      !xmlStrEqual(ns, BAD_CAST "urn:oasis:names:tc:opendocument:xmlns:office:1.0")
                    : !xmlStrEqual(local, BAD_CAST "document") ||
                      !xmlStrEqual(ns, BAD_CAST "http://schemas.openxmlformats.org/wordprocessingml/2006/main")) goto end;
        }
        if (type == XML_READER_TYPE_ELEMENT) {
            if (odt && xmlStrEqual(local, BAD_CAST "body")) active = 1;
            if (!odt && xmlStrEqual(local, BAD_CAST "body")) active = 1;
            if (active && xmlStrEqual(local, BAD_CAST "tab")) {
                if (append(out, &used, (const unsigned char *)" ", 1)) goto end;
            }
            if (active && ((odt && xmlStrEqual(local, BAD_CAST "line-break")) ||
                           (!odt && xmlStrEqual(local, BAD_CAST "br")))) {
                if (append(out, &used, (const unsigned char *)"\n", 1)) goto end;
            }
            if (active && odt && xmlStrEqual(local, BAD_CAST "s")) {
                xmlChar *count = xmlTextReaderGetAttributeNs(
                    reader, BAD_CAST "c", BAD_CAST "urn:oasis:names:tc:opendocument:xmlns:text:1.0");
                unsigned long spaces = 1;
                if (count) {
                    char *end = NULL;
                    spaces = strtoul((const char *)count, &end, 10);
                    int valid = end != (char *)count && *end == '\0' && spaces > 0 && spaces <= 1024;
                    xmlFree(count);
                    if (!valid) goto end;
                }
                for (unsigned long i = 0; i < spaces; i++)
                    if (append(out, &used, (const unsigned char *)" ", 1)) goto end;
            }
        } else if (type == XML_READER_TYPE_END_ELEMENT && active &&
                   (xmlStrEqual(local, BAD_CAST "p") || xmlStrEqual(local, BAD_CAST "h") ||
                    xmlStrEqual(local, BAD_CAST "tr"))) {
            if (append(out, &used, (const unsigned char *)"\n", 1)) goto end;
        } else if ((type == XML_READER_TYPE_TEXT || type == XML_READER_TYPE_CDATA) && active) {
            const xmlChar *value = xmlTextReaderConstValue(reader);
            if (value && !xmlCheckUTF8(value)) goto end;
            if (value && write_safe_text(out, &used, value)) goto end;
        }
    }
    if (status == 0 && active && used) result = 0;
end:
    xmlFreeTextReader(reader);
    return result;
}

int workspace_document_to_text(const char *input_path, const char *output_path) {
    if (!input_path || !output_path) return -1;
    struct stat st;
    if (stat(input_path, &st) || !S_ISREG(st.st_mode) || st.st_size < 0 || st.st_size > MAX_ARCHIVE) return -1;
    int err = 0, result = -1;
    zip_t *archive = zip_open(input_path, ZIP_RDONLY, &err);
    if (!archive) return -1;
    zip_int64_t count = zip_get_num_entries(archive, 0);
    if (count <= 0 || count > MAX_ENTRIES) goto end;
    int odt = ends_with(input_path, ".odt");
    if (!odt && !ends_with(input_path, ".docx")) goto end;
    const char *target = odt ? "content.xml" : "word/document.xml";
    zip_uint64_t target_index = 0, mime_index = 0, meta_index = 0;
    int target_found = 0, mime_found = 0, meta_found = 0;
    for (zip_uint64_t i = 0; i < (zip_uint64_t)count; i++) {
        zip_stat_t entry;
        if (zip_stat_index(archive, i, 0, &entry) || !entry.name || dangerous_name(entry.name) ||
            !(entry.valid & ZIP_STAT_SIZE) || !(entry.valid & ZIP_STAT_COMP_SIZE) ||
            entry.size > MAX_ARCHIVE || (entry.size > 0 && entry.comp_size == 0) ||
            (entry.comp_size && entry.size / entry.comp_size > 100) ||
            (entry.valid & ZIP_STAT_ENCRYPTION_METHOD && entry.encryption_method != ZIP_EM_NONE) ||
            ends_with(entry.name, "vbaProject.bin") || ends_with(entry.name, ".exe")) goto end;
        zip_uint8_t opsys;
        zip_uint32_t attrs;
        if (!zip_file_get_external_attributes(archive, i, 0, &opsys, &attrs) &&
            opsys == ZIP_OPSYS_UNIX && ((attrs >> 16) & 0170000) == 0120000) goto end;
        if (strcmp(entry.name, target) == 0) {
            if (target_found || entry.size == 0 || entry.size > MAX_XML) goto end;
            target_found = 1; target_index = i;
        }
        if (strcmp(entry.name, "mimetype") == 0) {
            if (mime_found) goto end;
            mime_found = 1; mime_index = i;
        }
        if (strcmp(entry.name, odt ? "META-INF/manifest.xml" : "[Content_Types].xml") == 0) {
            if (meta_found || entry.size == 0 || entry.size > MAX_XML) goto end;
            meta_found = 1; meta_index = i;
        }
    }
    if (!target_found || !meta_found || (odt && !mime_found)) goto end;
    if (odt) {
        zip_stat_t mime;
        if (zip_stat_index(archive, mime_index, 0, &mime) || mime.size != 39) goto end;
        unsigned char *value = read_member(archive, mime_index, (size_t)mime.size);
        int valid = value && strcmp((const char *)value, "application/vnd.oasis.opendocument.text") == 0;
        free(value);
        if (!valid) goto end;
    }
    zip_stat_t metadata_stat;
    if (zip_stat_index(archive, meta_index, 0, &metadata_stat)) goto end;
    unsigned char *metadata = read_member(archive, meta_index, (size_t)metadata_stat.size);
    if (!metadata) goto end;
    int metadata_valid = odt
        ? !contains_bytes(metadata, (size_t)metadata_stat.size, "encryption-data")
        : contains_bytes(metadata, (size_t)metadata_stat.size,
                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") &&
          !contains_bytes(metadata, (size_t)metadata_stat.size, "macroEnabled");
    free(metadata);
    if (!metadata_valid) goto end;
    zip_stat_t target_stat;
    if (zip_stat_index(archive, target_index, 0, &target_stat)) goto end;
    unsigned char *xml = read_member(archive, target_index, (size_t)target_stat.size);
    if (!xml) goto end;
    int fd = open(output_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) { free(xml); goto end; }
    FILE *out = fdopen(fd, "wb");
    if (!out) { close(fd); unlink(output_path); free(xml); goto end; }
    result = xml_to_text(xml, (size_t)target_stat.size, out, odt);
    int flushed = fflush(out);
    int closed = fclose(out);
    if (flushed || closed) result = -1;
    if (result) unlink(output_path);
    free(xml);
end:
    zip_close(archive);
    return result;
}
