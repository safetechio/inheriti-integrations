#include "document_converter.h"

int main(int argc, char **argv) {
    return argc == 3 && workspace_document_to_text(argv[1], argv[2]) == 0 ? 0 : 2;
}
