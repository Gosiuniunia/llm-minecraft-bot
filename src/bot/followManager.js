/**
 * followManager — sprawia że bot pojawia się przy graczu i może go śledzić.
 *
 * Funkcje:
 *  - teleportToPlayer()  : idzie do gracza (używane przy starcie)
 *  - startFollowing()    : ciągle śledzi gracza
 *  - stopFollowing()     : zatrzymuje śledzenie
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { logger } from "../utils/logger.js";

export class FollowManager {
  constructor(bot) {
    this.bot = bot;
    this._followInterval = null;
    this._currentTarget = null;
  }

  /** Idź do gracza jednorazowo (np. przy spawnie) */
  async goToPlayer(username) {
    const player = this._findPlayer(username);
    if (!player) {
      logger.warn(`goToPlayer: gracz "${username}" nie znaleziony`);
      return false;
    }

    const pos = player.entity?.position;
    if (!pos) return false;

    logger.info(`Idę do gracza: ${username}`);
    try {
      await this.bot.pathfinder.goto(
        new goals.GoalNear(pos.x, pos.y, pos.z, 2)
      );
      return true;
    } catch (err) {
      logger.warn(`Nie mogę dojść do ${username}: ${err.message}`);
      return false;
    }
  }

  /** Zacznij śledzić gracza — co sekundę aktualizuj cel */
  startFollowing(username) {
    this.stopFollowing();
    this._currentTarget = username;

    this._followInterval = setInterval(() => {
      const player = this._findPlayer(username);
      if (!player?.entity) return;

      const pos = player.entity.position;
      const dist = this.bot.entity.position.distanceTo(pos);

      // Nie idź jeśli jesteś już blisko (2-3 bloki)
      if (dist < 3) return;

      this.bot.pathfinder.setGoal(
        new goals.GoalFollow(player.entity, 2),
        true // dynamiczne — aktualizuje cel w ruchu
      );
    }, 1000);

    logger.info(`Zaczynam śledzić: ${username}`);
  }

  stopFollowing() {
    if (this._followInterval) {
      clearInterval(this._followInterval);
      this._followInterval = null;
    }
    if (this._currentTarget) {
      this.bot.pathfinder.setGoal(null);
      this._currentTarget = null;
    }
  }

  isFollowing() {
    return this._currentTarget !== null;
  }

  _findPlayer(username) {
    return this.bot.players[username] ?? null;
  }
}
