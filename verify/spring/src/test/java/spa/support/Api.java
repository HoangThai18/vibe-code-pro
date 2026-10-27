package spa.support;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** HTTP calls against the running app, with a signed token whose sub is the user id. */
public final class Api {
    public record Res(int status, JsonNode body) {
        public String code() {
            return body.path("error").path("code").asString();
        }
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private final String base;

    Api(int port) {
        this.base = "http://localhost:" + port;
    }

    public static String token(UUID userId) {
        try {
            var claims = new JWTClaimsSet.Builder().subject(userId.toString())
                .expirationTime(Date.from(Instant.now().plusSeconds(3600))).build();
            var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(System.getenv("JWT_SECRET").getBytes(StandardCharsets.UTF_8)));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    public Res get(String path, UUID user) {
        return send("GET", path, user, null);
    }

    public Res post(String path, UUID user, Object body) {
        return send("POST", path, user, body);
    }

    public Res patch(String path, UUID user, Object body) {
        return send("PATCH", path, user, body);
    }

    public Res send(String method, String path, UUID user, Object body) {
        var req = HttpRequest.newBuilder(URI.create(base + path))
            .header("Authorization", "Bearer " + token(user))
            .header("Content-Type", "application/json")
            .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
        try {
            HttpResponse<String> res = HTTP.send(req.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode json = res.body().isEmpty() ? JSON.createObjectNode() : JSON.readTree(res.body());
            return new Res(res.statusCode(), json);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
