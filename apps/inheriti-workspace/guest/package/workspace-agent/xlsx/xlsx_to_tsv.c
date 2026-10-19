/* Read-only, bounded XLSX text extraction for the workspace virtual machine.
 * Build with: cc xlsx_to_tsv.c -o xlsx-to-tsv $(pkg-config --cflags --libs libzip libxml-2.0)
 */
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <zip.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define MAX_ARCHIVE (16u * 1024u * 1024u)
#define MAX_PART (2u * 1024u * 1024u)
#define MAX_OUTPUT (1024u * 1024u)
#define MAX_ENTRIES 256
#define MAX_ROWS 5000
#define MAX_COLUMNS 128
#define MAX_STRINGS 10000

static zip_t *archive;
static FILE *output;
static size_t written;
static xmlChar **strings;
static size_t string_count;

static int named(const xmlNode *node, const char *name) {
    return node && node->type == XML_ELEMENT_NODE && xmlStrEqual(node->name, BAD_CAST name);
}

static xmlNode *child(xmlNode *node, const char *name) {
    for (xmlNode *item = node ? node->children : NULL; item; item = item->next)
        if (named(item, name)) return item;
    return NULL;
}

static int emit(const char *value, size_t length) {
    if (length > MAX_OUTPUT - written || fwrite(value, 1, length, output) != length) return -1;
    written += length;
    return 0;
}

static int emit_text(const xmlChar *value) {
    if (!value) return 0;
    for (const unsigned char *p = value; *p;) {
        size_t length = 1;
        uint32_t codepoint = *p;
        if ((*p & 0xe0) == 0xc0) { length = 2; codepoint = *p & 0x1f; }
        else if ((*p & 0xf0) == 0xe0) { length = 3; codepoint = *p & 0x0f; }
        else if ((*p & 0xf8) == 0xf0) { length = 4; codepoint = *p & 0x07; }
        for (size_t i = 1; i < length; i++) {
            if (!p[i] || (p[i] & 0xc0) != 0x80) return -1;
            codepoint = (codepoint << 6) | (p[i] & 0x3f);
        }
        /* Prevent terminal commands, hidden direction changes and TSV layout changes. */
        if (codepoint < 0x20 || (codepoint >= 0x7f && codepoint <= 0x9f) ||
            codepoint == 0x200e || codepoint == 0x200f ||
            (codepoint >= 0x202a && codepoint <= 0x202e) ||
            (codepoint >= 0x2066 && codepoint <= 0x2069) ||
            codepoint == 0x2028 || codepoint == 0x2029 || codepoint == 0xfeff) {
            if (emit(" ", 1)) return -1;
        } else if (emit((const char *)p, length)) return -1;
        p += length;
    }
    return 0;
}

static xmlDoc *part(const char *path) {
    zip_stat_t stat;
    if (zip_stat(archive, path, ZIP_FL_ENC_GUESS, &stat) || stat.size > MAX_PART) return NULL;
    zip_file_t *file = zip_fopen(archive, path, 0);
    if (!file) return NULL;
    char *buffer = malloc((size_t)stat.size + 1);
    if (!buffer) { zip_fclose(file); return NULL; }
    size_t received = 0;
    while (received < stat.size) {
        zip_int64_t got = zip_fread(file, buffer + received, stat.size - received);
        if (got <= 0) break;
        received += (size_t)got;
    }
    int closed = zip_fclose(file);
    if (received != stat.size || closed) { free(buffer); return NULL; }
    buffer[stat.size] = 0;
    /* DTD/entities are not part of the supported OOXML subset. */
    if (strstr(buffer, "<!DOCTYPE") || strstr(buffer, "<!ENTITY")) { free(buffer); return NULL; }
    xmlDoc *doc = xmlReadMemory(buffer, (int)stat.size, path, NULL, XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING);
    free(buffer);
    if (doc && (doc->intSubset || doc->extSubset)) { xmlFreeDoc(doc); return NULL; }
    return doc;
}

static int column(const xmlChar *reference) {
    if (!reference || !*reference) return -1;
    int value = 0;
    const unsigned char *p = reference;
    while (*p >= 'A' && *p <= 'Z') {
        value = value * 26 + (*p++ - 'A' + 1);
        if (value > MAX_COLUMNS) return -1;
    }
    if (value == 0 || !isdigit(*p)) return -1;
    while (isdigit(*p)) p++;
    return *p ? -1 : value - 1;
}

static int shared_strings(void) {
    zip_stat_t stat;
    if (zip_stat(archive, "xl/sharedStrings.xml", 0, &stat)) return 0;
    xmlDoc *doc = part("xl/sharedStrings.xml");
    if (!doc) return -1;
    xmlNode *root = xmlDocGetRootElement(doc);
    if (!named(root, "sst")) { xmlFreeDoc(doc); return -1; }
    int result = 0;
    strings = calloc(MAX_STRINGS, sizeof(*strings));
    if (!strings) { xmlFreeDoc(doc); return -1; }
    for (xmlNode *si = root->children; si; si = si->next) {
        if (!named(si, "si")) continue;
        if (string_count == MAX_STRINGS) { result = -1; break; }
        xmlBuffer *buf = xmlBufferCreate();
        if (!buf) { result = -1; break; }
        for (xmlNode *item = si->children; item; item = item->next) {
            xmlNode *t = named(item, "t") ? item : named(item, "r") ? child(item, "t") : NULL;
            if (t) {
                xmlChar *text = xmlNodeGetContent(t);
                if (text) { xmlBufferCat(buf, text); xmlFree(text); }
            }
        }
        strings[string_count++] = xmlStrdup(xmlBufferContent(buf));
        xmlBufferFree(buf);
        if (!strings[string_count - 1]) { result = -1; break; }
    }
    xmlFreeDoc(doc);
    return result;
}

static int cell_value(xmlNode *cell_node) {
    xmlChar *type = xmlGetProp(cell_node, BAD_CAST "t");
    xmlNode *v = child(cell_node, "v");
    xmlChar *value = v ? xmlNodeGetContent(v) : NULL;
    int result = 0;
    if (type && xmlStrEqual(type, BAD_CAST "inlineStr")) {
        xmlNode *is = child(cell_node, "is");
        if (!is) result = -1;
        else {
            xmlNode *t = child(is, "t");
            if (t) { xmlChar *s = xmlNodeGetContent(t); result = emit_text(s); xmlFree(s); }
            else for (xmlNode *r = is->children; r; r = r->next)
                if (named(r, "r") && (t = child(r, "t"))) {
                    xmlChar *s = xmlNodeGetContent(t);
                    if (emit_text(s)) result = -1;
                    xmlFree(s);
                    if (result) break;
                }
        }
    } else if (type && xmlStrEqual(type, BAD_CAST "s")) {
        char *end = NULL;
        unsigned long index = value ? strtoul((char *)value, &end, 10) : 0;
        if (!value || !*value || *end || index >= string_count) result = -1;
        else result = emit_text(strings[index]);
    } else if (child(cell_node, "f") && !v) {
        result = -1; /* Never evaluate a formula; only stored result values are shown. */
    } else if (!type || xmlStrEqual(type, BAD_CAST "n") ||
               xmlStrEqual(type, BAD_CAST "str") || xmlStrEqual(type, BAD_CAST "b")) {
        result = emit_text(value);
    } else if (xmlStrEqual(type, BAD_CAST "e")) {
        result = emit_text(value);
    } else result = -1;
    xmlFree(type);
    xmlFree(value);
    return result;
}

static int sheet(const char *path, const xmlChar *name) {
    xmlDoc *doc = part(path);
    if (!doc) return -1;
    xmlNode *root = xmlDocGetRootElement(doc);
    xmlNode *data = named(root, "worksheet") ? child(root, "sheetData") : NULL;
    if (!data || emit("\nSheet: ", 8) || emit_text(name) || emit("\n", 1)) { xmlFreeDoc(doc); return -1; }
    int last_row = 0, result = 0;
    for (xmlNode *row = data->children; row && !result; row = row->next) {
        if (!named(row, "row")) continue;
        xmlChar *row_ref = xmlGetProp(row, BAD_CAST "r");
        char *end = NULL;
        long row_number = row_ref ? strtol((char *)row_ref, &end, 10) : 0;
        if (!row_ref || *end || row_number <= last_row || row_number > MAX_ROWS) result = -1;
        xmlFree(row_ref);
        if (result) break;
        while (++last_row < row_number) if (emit("\n", 1)) { result = -1; break; }
        if (result) break;
        int next_column = 0;
        for (xmlNode *cell = row->children; cell; cell = cell->next) {
            if (!named(cell, "c")) continue;
            xmlChar *ref = xmlGetProp(cell, BAD_CAST "r");
            int target = column(ref);
            xmlFree(ref);
            if (target < next_column) { result = -1; break; }
            while (next_column <= target) {
                if (next_column++ && emit("\t", 1)) { result = -1; break; }
            }
            if (result || cell_value(cell)) { result = -1; break; }
        }
        if (!result && emit("\n", 1)) result = -1;
    }
    xmlFreeDoc(doc);
    return result;
}

static int safe_target(const xmlChar *target, char *path, size_t size) {
    if (!target) return -1;
    const char *relative = (const char *)target;
    if (relative[0] == '/') {
        if (strncmp(relative, "/xl/worksheets/", 15)) return -1;
        relative += 4; /* Package-absolute targets start at the archive root. */
    }
    if (strncmp(relative, "worksheets/", 11) || !relative[11] ||
        strstr(relative, "..") || strstr(relative, "//") ||
        strchr(relative, '\\') || strchr(relative, ':') ||
        strchr(relative, '?') || strchr(relative, '#')) return -1;
    int n = snprintf(path, size, "xl/%s", relative);
    return n > 3 && (size_t)n < size ? 0 : -1;
}

static int convert(void) {
    xmlDoc *workbook = part("xl/workbook.xml");
    xmlDoc *rels = part("xl/_rels/workbook.xml.rels");
    if (!workbook || !rels || shared_strings()) {
        if (workbook) xmlFreeDoc(workbook);
        if (rels) xmlFreeDoc(rels);
        return -1;
    }
    xmlNode *workbook_root = xmlDocGetRootElement(workbook);
    xmlNode *sheets = named(workbook_root, "workbook") ? child(workbook_root, "sheets") : NULL;
    xmlNode *relationships = xmlDocGetRootElement(rels);
    if (!sheets || !named(relationships, "Relationships")) {
        xmlFreeDoc(workbook); xmlFreeDoc(rels); return -1;
    }
    int count = 0, result = 0;
    for (xmlNode *s = sheets->children; s && !result; s = s->next) {
        if (!named(s, "sheet")) continue;
        if (++count > 32) { result = -1; break; }
        xmlChar *name = xmlGetProp(s, BAD_CAST "name");
        xmlChar *id = xmlGetNsProp(s, BAD_CAST "id", BAD_CAST "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
        char path[256] = {0};
        int found = 0;
        for (xmlNode *r = relationships->children; r && !found; r = r->next) {
            if (!named(r, "Relationship")) continue;
            xmlChar *rid = xmlGetProp(r, BAD_CAST "Id");
            if (rid && id && xmlStrEqual(rid, id)) {
                xmlChar *type = xmlGetProp(r, BAD_CAST "Type");
                xmlChar *target = xmlGetProp(r, BAD_CAST "Target");
                xmlChar *mode = xmlGetProp(r, BAD_CAST "TargetMode");
                const char *suffix = "/worksheet";
                size_t len = type ? xmlStrlen(type) : 0;
                if (!mode && len >= strlen(suffix) && !strcmp((char *)type + len - strlen(suffix), suffix) &&
                    !safe_target(target, path, sizeof(path))) found = 1;
                xmlFree(type); xmlFree(target); xmlFree(mode);
            }
            xmlFree(rid);
        }
        if (!name || !found || sheet(path, name)) result = -1;
        xmlFree(name); xmlFree(id);
    }
    xmlFreeDoc(workbook); xmlFreeDoc(rels);
    return count && !result ? 0 : -1;
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    struct stat input_stat;
    if (stat(argv[1], &input_stat) || !S_ISREG(input_stat.st_mode) ||
        input_stat.st_size <= 0 || input_stat.st_size > MAX_ARCHIVE) return 2;
    int error = 0;
    archive = zip_open(argv[1], ZIP_RDONLY, &error);
    if (!archive) return 2;
    zip_int64_t entries = zip_get_num_entries(archive, 0);
    size_t expanded = 0;
    if (entries <= 0 || entries > MAX_ENTRIES) error = 1;
    for (zip_uint64_t i = 0; !error && i < (zip_uint64_t)entries; i++) {
        zip_stat_t item;
        if (zip_stat_index(archive, i, 0, &item) || !item.name || item.size > MAX_PART ||
            item.size > MAX_ARCHIVE - expanded ||
            (item.comp_size && item.size / item.comp_size > 100) ||
            !(item.valid & ZIP_STAT_ENCRYPTION_METHOD) || item.encryption_method != ZIP_EM_NONE ||
            strstr(item.name, "vbaProject") || strstr(item.name, "..")) error = 1;
        else {
            for (zip_uint64_t j = 0; j < i; j++) {
                const char *previous = zip_get_name(archive, j, 0);
                if (previous && !strcmp(previous, item.name)) { error = 1; break; }
            }
            expanded += item.size;
        }
    }
    if (!error) {
        output = fopen(argv[2], "wx");
        if (!output) error = 1;
        else {
            error = convert();
            if (fclose(output)) error = 1;
            if (error) remove(argv[2]);
        }
    }
    for (size_t i = 0; i < string_count; i++) xmlFree(strings[i]);
    free(strings);
    zip_close(archive);
    return error ? 2 : 0;
}
