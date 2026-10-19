#ifndef WORKSPACE_DOCUMENT_CONVERTER_H
#define WORKSPACE_DOCUMENT_CONVERTER_H

/* Extract visible DOCX or ODT text into a private session file.
 * Returns zero only after the entire archive and XML have passed validation. */
int workspace_document_to_text(const char *input_path, const char *output_path);

#endif
