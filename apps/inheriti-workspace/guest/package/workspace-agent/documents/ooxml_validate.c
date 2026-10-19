/* Bounded OOXML admission for optional viewers. No files are extracted to disk. */
#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE
#include <zip.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#define MAX_ARCHIVE (16u * 1024u * 1024u)
#define MAX_ENTRIES 256
#define MAX_PART (4u * 1024u * 1024u)
#define MAX_NAME 4096

static int unsafe_name(const char *name) {
    size_t len = strnlen(name, MAX_NAME + 1);
    if (!len || len > MAX_NAME || name[0] == '/' || name[0] == '\\') return 1;
    const char *part = name;
    for (const char *p = name;; p++) {
        if (*p == '\\' || *p == ':' || (*p && (unsigned char)*p < 32)) return 1;
        if (*p == '/' || *p == 0) {
            size_t width = (size_t)(p - part);
            if (!width && *p != 0) return 1;
            if ((width == 1 && part[0] == '.') ||
                (width == 2 && part[0] == '.' && part[1] == '.')) return 1;
            if (*p == 0) break;
            part = p + 1;
        }
    }
    return 0;
}

static int executable_name(const char *name) {
    size_t length = strlen(name);
    return length >= 4 && strcasecmp(name + length - 4, ".exe") == 0;
}

static int contains(const unsigned char *buffer, size_t length, const char *needle) {
    size_t wanted = strlen(needle);
    for (size_t i = 0; i + wanted <= length; i++)
        if (memcmp(buffer + i, needle, wanted) == 0) return 1;
    return 0;
}

static int validate(const char *path, const char *kind) {
    int docx = strcmp(kind, "docx") == 0;
    if (!docx && strcmp(kind, "xlsx") != 0) return -1;
    struct stat source;
    if (stat(path, &source) || !S_ISREG(source.st_mode) || source.st_size <= 0 ||
        (uint64_t)source.st_size > MAX_ARCHIVE) return -1;
    int error = 0, result = -1;
    zip_t *archive = zip_open(path, ZIP_RDONLY | ZIP_CHECKCONS, &error);
    if (!archive) return -1;
    zip_int64_t count = zip_get_num_entries(archive, 0);
    if (count <= 0 || count > MAX_ENTRIES) goto end;
    const char *main_part = docx ? "word/document.xml" : "xl/workbook.xml";
    int found_main = 0, found_types = 0;
    uint64_t total = 0;
    for (zip_uint64_t i = 0; i < (zip_uint64_t)count; i++) {
        zip_stat_t item;
        zip_stat_init(&item);
        if (zip_stat_index(archive, i, ZIP_FL_ENC_STRICT, &item) ||
            (item.valid & (ZIP_STAT_NAME | ZIP_STAT_SIZE | ZIP_STAT_COMP_SIZE |
                           ZIP_STAT_ENCRYPTION_METHOD | ZIP_STAT_COMP_METHOD)) !=
            (ZIP_STAT_NAME | ZIP_STAT_SIZE | ZIP_STAT_COMP_SIZE |
             ZIP_STAT_ENCRYPTION_METHOD | ZIP_STAT_COMP_METHOD) ||
            unsafe_name(item.name) || item.size > MAX_PART || item.comp_size > MAX_ARCHIVE ||
            item.size > MAX_ARCHIVE - total ||
            (item.size && (!item.comp_size || item.size > item.comp_size * 100u)) ||
            item.encryption_method != ZIP_EM_NONE ||
            (item.comp_method != ZIP_CM_STORE && item.comp_method != ZIP_CM_DEFLATE) ||
            strstr(item.name, "vbaProject") || executable_name(item.name)) goto end;
        total += item.size;
        zip_uint8_t os = 0;
        zip_uint32_t attributes = 0;
        if (zip_file_get_external_attributes(archive, i, 0, &os, &attributes)) goto end;
        if (os == ZIP_OPSYS_UNIX) {
            unsigned kind_bits = (attributes >> 16) & S_IFMT;
            if (kind_bits && kind_bits != S_IFREG && kind_bits != S_IFDIR) goto end;
        }
        for (zip_uint64_t j = 0; j < i; j++) {
            const char *previous = zip_get_name(archive, j, ZIP_FL_ENC_STRICT);
            if (!previous || strcasecmp(previous, item.name) == 0) goto end;
        }
        if (strcmp(item.name, main_part) == 0) {
            if (found_main || !item.size) goto end;
            found_main = 1;
        }
        int content_types = strcmp(item.name, "[Content_Types].xml") == 0;
        if (content_types) {
            if (found_types || !item.size || item.size > 65536) goto end;
            found_types = 1;
        }
        /* Read each member to enforce decompression bounds and CRC checks. */
        if (item.name[strlen(item.name) - 1] == '/' && item.size) goto end;
        zip_file_t *member = zip_fopen_index(archive, i, 0);
        if (!member) goto end;
        unsigned char *types = content_types ? malloc((size_t)item.size) : NULL;
        if (content_types && !types) { zip_fclose(member); goto end; }
        unsigned char buffer[8192];
        zip_uint64_t read_total = 0;
        zip_int64_t got;
        while ((got = zip_fread(member, buffer, sizeof buffer)) > 0) {
            read_total += (zip_uint64_t)got;
            if (read_total > item.size) break;
            if (types) memcpy(types + read_total - (zip_uint64_t)got, buffer, (size_t)got);
        }
        int closed = zip_fclose(member);
        if (got < 0 || read_total != item.size || closed) { free(types); goto end; }
        if (types) {
            const char *mime = docx
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
            int valid = contains(types, (size_t)item.size, mime) &&
                        !contains(types, (size_t)item.size, "macroEnabled");
            free(types);
            if (!valid) goto end;
        }
    }
    if (found_main && found_types) result = 0;
end:
    zip_close(archive);
    return result;
}

int main(int argc, char **argv) {
    return argc == 3 && validate(argv[1], argv[2]) == 0 ? 0 : 2;
}
