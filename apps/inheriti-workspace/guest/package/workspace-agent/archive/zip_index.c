/* Bounded, read-only ZIP inventory. Archive members are never opened or extracted. */
#define _POSIX_C_SOURCE 200809L
#include <zip.h>
#include <ctype.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define MAX_ARCHIVE (16u * 1024u * 1024u)
#define MAX_ENTRIES 256
#define MAX_MEMBER (16u * 1024u * 1024u)
#define MAX_TOTAL (16u * 1024u * 1024u)
#define MAX_NAME 4096
#define MAX_OUTPUT (1024u * 1024u)
#define MAX_RATIO 100u

static char output[MAX_OUTPUT];
static size_t used;

static int append(const char *value, size_t length) {
    if (length > sizeof(output) - used) return -1;
    memcpy(output + used, value, length);
    used += length;
    return 0;
}

static int codepoint(const unsigned char *p, size_t remaining, size_t *length, uint32_t *value) {
    uint32_t cp = p[0];
    *length = 1;
    if (cp < 0x80) { *value = cp; return 0; }
    if (cp >= 0xc2 && cp <= 0xdf) { cp &= 0x1f; *length = 2; }
    else if (cp >= 0xe0 && cp <= 0xef) { cp &= 0x0f; *length = 3; }
    else if (cp >= 0xf0 && cp <= 0xf4) { cp &= 0x07; *length = 4; }
    else return -1;
    if (*length > remaining) return -1;
    for (size_t i = 1; i < *length; ++i) {
        if ((p[i] & 0xc0) != 0x80) return -1;
        cp = (cp << 6) | (p[i] & 0x3f);
    }
    if (cp < (*length == 2 ? 0x80u : *length == 3 ? 0x800u : 0x10000u) ||
        (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return -1;
    *value = cp;
    return 0;
}

static int neutralize_name(const char *name, char *safe, size_t capacity) {
    size_t length = strnlen(name, MAX_NAME + 1);
    if (!length || length > MAX_NAME || name[0] == '/' || name[0] == 92) return -1;
    size_t at = 0, segment = 0;
    for (size_t i = 0; i < length;) {
        unsigned char byte = (unsigned char)name[i];
        if (byte == 92 || byte == ':' || byte == 0) return -1;
        if (byte == '/') {
            size_t part = i - segment;
            if (!part || (part == 1 && name[segment] == '.') ||
                (part == 2 && name[segment] == '.' && name[segment + 1] == '.')) return -1;
            segment = i + 1;
        }
        size_t width;
        uint32_t cp;
        if (codepoint((const unsigned char *)name + i, length - i, &width, &cp)) return -1;
        int unsafe = cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ||
                     cp == 0x200e || cp == 0x200f || cp == 0x2028 || cp == 0x2029 ||
                     (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) ||
                     cp == 0xfeff;
        if (at + (unsafe ? 1 : width) >= capacity) return -1;
        if (unsafe) safe[at++] = ' ';
        else { memcpy(safe + at, name + i, width); at += width; }
        i += width;
    }
    if (segment < length) {
        size_t part = length - segment;
        if ((part == 1 && name[segment] == '.') ||
            (part == 2 && name[segment] == '.' && name[segment + 1] == '.')) return -1;
    }
    safe[at] = 0;
    return 0;
}

static int index_archive(const char *path) {
    struct stat source;
    if (stat(path, &source) || !S_ISREG(source.st_mode) || source.st_size <= 0 ||
        (uint64_t)source.st_size > MAX_ARCHIVE) return -1;
    int error = 0;
    zip_t *archive = zip_open(path, ZIP_RDONLY | ZIP_CHECKCONS, &error);
    if (!archive) return -1;
    zip_int64_t count = zip_get_num_entries(archive, 0);
    if (count < 0 || count > MAX_ENTRIES) { zip_close(archive); return -1; }
    char seen[MAX_ENTRIES][MAX_NAME + 1];
    zip_uint64_t total = 0;
    static const char header[] = "ZIP contents (listing only; files are not opened)\n";
    int result = append(header, sizeof(header) - 1);
    for (zip_uint64_t i = 0; i < (zip_uint64_t)count && !result; ++i) {
        zip_stat_t item;
        zip_stat_init(&item);
        if (zip_stat_index(archive, i, ZIP_FL_ENC_STRICT, &item) ||
            (item.valid & (ZIP_STAT_NAME | ZIP_STAT_SIZE | ZIP_STAT_COMP_SIZE |
                           ZIP_STAT_ENCRYPTION_METHOD | ZIP_STAT_COMP_METHOD)) !=
            (ZIP_STAT_NAME | ZIP_STAT_SIZE | ZIP_STAT_COMP_SIZE |
             ZIP_STAT_ENCRYPTION_METHOD | ZIP_STAT_COMP_METHOD) ||
            item.encryption_method != ZIP_EM_NONE ||
            (item.comp_method != ZIP_CM_STORE && item.comp_method != ZIP_CM_DEFLATE) ||
            item.size > MAX_MEMBER || item.size > MAX_TOTAL - total ||
            (item.size && (!item.comp_size || item.size > item.comp_size * MAX_RATIO))) {
            result = -1; break;
        }
        total += item.size;
        zip_uint8_t operating_system = 0;
        zip_uint32_t attributes = 0;
        if (zip_file_get_external_attributes(archive, i, 0, &operating_system, &attributes)) {
            result = -1; break;
        }
        if (operating_system == ZIP_OPSYS_UNIX) {
            unsigned mode = attributes >> 16;
            unsigned kind = mode & S_IFMT;
            if (kind && kind != S_IFREG && kind != S_IFDIR) { result = -1; break; }
        }
        char safe[MAX_NAME + 1];
        if (neutralize_name(item.name, safe, sizeof(safe))) { result = -1; break; }
        size_t len = strlen(safe);
        int directory = len && safe[len - 1] == '/';
        for (size_t j = 0; j < len; ++j) seen[i][j] = (char)tolower((unsigned char)safe[j]);
        seen[i][len] = 0;
        for (zip_uint64_t j = 0; j < i; ++j) {
            if (!strcmp(seen[j], seen[i])) { result = -1; break; }
        }
        if (result) break;
        char line[64];
        int number = snprintf(line, sizeof(line), "%-12" PRIu64 " ", item.size);
        if (number < 0 || (size_t)number >= sizeof(line) ||
            append(line, (size_t)number) || append(safe, len) || append("\n", 1)) result = -1;
        if (directory && item.size) result = -1;
    }
    if (zip_close(archive)) result = -1;
    return result;
}

int main(int argc, char **argv) {
    if (argc != 3 || index_archive(argv[1])) return 2;
    int fd = open(argv[2], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (fd < 0) return 2;
    size_t offset = 0;
    while (offset < used) {
        ssize_t count = write(fd, output + offset, used - offset);
        if (count <= 0) { close(fd); unlink(argv[2]); return 2; }
        offset += (size_t)count;
    }
    if (close(fd)) { unlink(argv[2]); return 2; }
    return 0;
}
