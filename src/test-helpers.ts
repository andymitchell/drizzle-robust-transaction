import { fileIoSyncNode } from "@andyrmitchell/file-io";

import { fileURLToPath } from 'url';





export function getRelativeTestDir(testScriptMetaUrl: string, subDir = 'test-schemas'): string {
    return `${fileIoSyncNode.directory_name(fileURLToPath(testScriptMetaUrl))}/${subDir}`;
}
export function clearDir(testDir: string): void {


    if (fileIoSyncNode.has_directory(testDir)) {
        fileIoSyncNode.remove_directory(testDir, true);
    }

}

