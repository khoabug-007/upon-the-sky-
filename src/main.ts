import './styles.css';
import { Network } from './net/Network';
import { Menu } from './ui/Menu';
import { Game } from './game/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const network = new Network();
const menu = new Menu(network);
menu.show();

menu.onEnterGame = (joinInfo, profile) => {
  menu.hide();
  new Game(canvas, network, profile, joinInfo);
};
