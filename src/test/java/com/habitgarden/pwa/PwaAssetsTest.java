package com.habitgarden.pwa;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.containsString;

/**
 * The install prompt only appears if the browser can fetch the manifest and its
 * icons while logged out. These assets must never sit behind authentication.
 */
@SpringBootTest(properties = {"GOOGLE_CLIENT_ID=test", "GOOGLE_CLIENT_SECRET=test"})
@AutoConfigureMockMvc
class PwaAssetsTest {

    @Autowired MockMvc mvc;

    @Test
    void manifestIsPublicAndInstallable() throws Exception {
        mvc.perform(get("/manifest.json"))
                .andExpect(status().isOk())
                // Only ASCII values are asserted: static files are served without a
                // charset, so MockHttpServletResponse decodes the body as ISO-8859-1
                // and any Korean string would come back mangled.
                .andExpect(jsonPath("$.name").exists())
                .andExpect(jsonPath("$.start_url").value("/"))
                .andExpect(jsonPath("$.scope").value("/"))
                .andExpect(jsonPath("$.display").value("standalone"))
                .andExpect(jsonPath("$.icons.length()").value(3));
    }

    @Test
    void iconsArePublic() throws Exception {
        mvc.perform(get("/icons/icon-192.png")).andExpect(status().isOk());
        mvc.perform(get("/icons/icon-512.png")).andExpect(status().isOk());
        mvc.perform(get("/icons/icon-maskable-512.png")).andExpect(status().isOk());
    }

    @Test
    void serviceWorkerIsPublic() throws Exception {
        mvc.perform(get("/sw.js")).andExpect(status().isOk());
    }

    @Test
    void indexLinksManifestAndRegistersWorker() throws Exception {
        // Targets /index.html rather than /: MockMvc records the welcome-page
        // forward without executing it, so GET / has an empty body under test.
        // Both serve the same file on a real server.
        mvc.perform(get("/index.html"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("rel=\"manifest\"")))
                .andExpect(content().string(containsString("/manifest.json")))
                .andExpect(content().string(containsString("navigator.serviceWorker.register")))
                .andExpect(content().string(containsString("id=\"offline-banner\"")));
    }
}
